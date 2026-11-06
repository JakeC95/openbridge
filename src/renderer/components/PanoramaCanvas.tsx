import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

interface Props {
  src: string;
  yaw: number;
  pitch: number;
  fov: number;
  className?: string;
  style?: CSSProperties;
  onReady?(): void;
  onError?(message: string): void;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uCanvas;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uTanHalfFov;
out vec4 outColor;

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - uCanvas) / uCanvas.y;
  vec3 dir = normalize(uForward + uRight * (p.x * uTanHalfFov) + uUp * (p.y * uTanHalfFov));
  float lon = atan(dir.x, -dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  vec2 uv = vec2(lon / 6.28318530718 + 0.5, 0.5 - lat / 3.14159265359);
  // Continuous UV gradients avoid the mip-level jump at the longitude seam.
  vec3 dX = dFdx(dir);
  vec3 dY = dFdy(dir);
  float ring = max(1e-5, dir.x * dir.x + dir.z * dir.z);
  float latScale = 1.0 / sqrt(max(1e-5, 1.0 - dir.y * dir.y));
  vec2 dUvX = vec2((-dir.z * dX.x + dir.x * dX.z) / ring, -dX.y * latScale);
  vec2 dUvY = vec2((-dir.z * dY.x + dir.x * dY.z) / ring, -dY.y * latScale);
  dUvX /= vec2(6.28318530718, 3.14159265359);
  dUvY /= vec2(6.28318530718, 3.14159265359);
  outColor = vec4(textureGrad(uImage, uv, dUvX, dUvY).rgb, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "shader compile failed";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

/** Equirectangular viewer for 8-bit previews (JPEG/PNG), matching the HDR path. */
export function PanoramaCanvas({ src, yaw, pitch, fov, className, style, onReady, onError }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const yawRef = useRef(yaw);
  const pitchRef = useRef(pitch);
  const fovRef = useRef(fov);
  const readyRef = useRef(onReady);
  const errorRef = useRef(onError);
  yawRef.current = yaw;
  pitchRef.current = pitch;
  fovRef.current = fov;
  readyRef.current = onReady;
  errorRef.current = onError;

  useEffect(() => {
    const element = canvas.current;
    const container = element?.parentElement;
    if (!element || !container) return;
    const gl = element.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "high-performance"
    });
    if (!gl) return;

    let cancelled = false;
    let texture: WebGLTexture | null = null;
    let vertex: WebGLShader | null = null;
    let fragment: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let observer: ResizeObserver | null = null;

    const draw = (): void => {
      if (!program) return;
      gl.useProgram(program);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.viewport(0, 0, element.width, element.height);
      gl.uniform2f(gl.getUniformLocation(program, "uCanvas"), element.width, element.height);
      const cp = Math.cos(pitchRef.current);
      const sp = Math.sin(pitchRef.current);
      const cy = Math.cos(yawRef.current);
      const sy = Math.sin(yawRef.current);
      gl.uniform3f(gl.getUniformLocation(program, "uForward"), sy * cp, sp, -cy * cp);
      gl.uniform3f(gl.getUniformLocation(program, "uRight"), cy, 0, sy);
      gl.uniform3f(gl.getUniformLocation(program, "uUp"), -sy * sp, cp, cy * sp);
      gl.uniform1f(gl.getUniformLocation(program, "uTanHalfFov"), Math.tan(fovRef.current / 2));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const fit = (): void => {
      const rect = container.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }
      draw();
    };

    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`Preview image returned HTTP ${response.status}`);
        const blob = await response.blob();
        let bitmap = await createImageBitmap(blob);
        // Cap GPU memory for very large tone-mapped panoramas while keeping
        // enough resolution for deep zoom.
        if (bitmap.width > 8192) {
          const resized = await createImageBitmap(bitmap, {
            resizeWidth: 8192,
            resizeHeight: Math.max(1, Math.round((bitmap.height * 8192) / bitmap.width)),
            resizeQuality: "high"
          });
          bitmap.close();
          bitmap = resized;
        }
        if (cancelled) {
          bitmap.close();
          return;
        }
        vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
        fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
        program = gl.createProgram();
        if (!program) throw new Error("Could not create panorama program");
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(program) ?? "Could not link panorama program");
        }
        gl.useProgram(program);
        buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "aPos");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        bitmap.close();
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.uniform1i(gl.getUniformLocation(program, "uImage"), 0);
        if (cancelled) return;
        drawRef.current = draw;
        observer = new ResizeObserver(() => fit());
        observer.observe(container);
        fit();
        readyRef.current?.();
      } catch (error) {
        if (!cancelled) {
          errorRef.current?.(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      drawRef.current = null;
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    };
  }, [src]);

  useEffect(() => {
    drawRef.current?.();
  }, [yaw, pitch, fov]);

  return <canvas ref={canvas} className={`pano-canvas ${className ?? ""}`.trim()} style={style} />;
}
