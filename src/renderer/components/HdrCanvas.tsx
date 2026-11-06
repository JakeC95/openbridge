import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { PoliigonHdrData } from "../../shared/types";

interface Props {
  data: PoliigonHdrData;
  exposureStops: number;
  zoom: number;
  pan: { x: number; y: number };
  projection?: "flat" | "equirect";
  yaw?: number;
  pitch?: number;
  fov?: number;
  style?: CSSProperties;
  className?: string;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uHdr;
uniform float uExposure;
uniform float uZoom;
uniform vec2 uPan;
uniform vec2 uCanvas;
uniform vec2 uImage;
uniform float uScale;
uniform int uEquirect;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uTanHalfFov;
out vec4 outColor;

vec3 aces(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  vec3 low = c * 12.92;
  vec3 high = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), c));
}

// Interleaved gradient noise: stable per-pixel dither without a lookup texture.
float gradientNoise(vec2 position) {
  return fract(52.9829189 * fract(dot(position, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 hdr;
  if (uEquirect == 1) {
    // Perspective ray through the fragment, then equirectangular lookup. This
    // is the same drag-to-look / wheel-to-zoom panorama model as Poly Haven's
    // viewer, implemented on our decoded linear HDR texture.
    vec2 p = (gl_FragCoord.xy * 2.0 - uCanvas) / uCanvas.y;
    vec3 dir = normalize(uForward + uRight * (p.x * uTanHalfFov) + uUp * (p.y * uTanHalfFov));
    float lon = atan(dir.x, -dir.z);
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    vec2 uv = vec2(lon / 6.28318530718 + 0.5, 0.5 - lat / 3.14159265359);
    // The longitude wraps at +/-PI, where implicit derivatives jump and the GPU
    // picks a blurry mip level (the visible seam). Derive the UV gradients from
    // the continuous view direction instead and sample with textureGrad.
    vec3 dX = dFdx(dir);
    vec3 dY = dFdy(dir);
    float ring = max(1e-5, dir.x * dir.x + dir.z * dir.z);
    float latScale = 1.0 / sqrt(max(1e-5, 1.0 - dir.y * dir.y));
    vec2 dUvX = vec2((-dir.z * dX.x + dir.x * dX.z) / ring, -dX.y * latScale);
    vec2 dUvY = vec2((-dir.z * dY.x + dir.x * dY.z) / ring, -dY.y * latScale);
    dUvX /= vec2(6.28318530718, 3.14159265359);
    dUvY /= vec2(6.28318530718, 3.14159265359);
    hdr = textureGrad(uHdr, uv, dUvX, dUvY).rgb;
  } else {
    // Map the screen pixel back into the image using the same fit/zoom/pan the
    // JPG viewer uses, so the HDR view is always pixel-identical in framing and
    // stays sharp at every zoom level instead of scaling a fit-sized buffer.
    vec2 screen = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
    float fit = min(uCanvas.x / uImage.x, uCanvas.y / uImage.y);
    vec2 displaySize = uImage * fit * uZoom;
    vec2 offset = (uCanvas - displaySize) * 0.5 + uPan * uScale;
    vec2 uv = (screen - offset) / displaySize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      outColor = vec4(0.0);
      return;
    }
    hdr = texture(uHdr, uv).rgb;
  }
  hdr *= uExposure;
  vec3 srgb = linearToSrgb(aces(hdr));
  // Triangular-PDF dither at one 8-bit step kills the banding that exposure
  // reveals in smooth sky gradients, without adding visible grain.
  float dither = gradientNoise(gl_FragCoord.xy)
    + gradientNoise(gl_FragCoord.xy + vec2(5.588238, 5.588238)) - 1.0;
  srgb += dither / 255.0;
  outColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
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

export function HdrCanvas({
  data,
  exposureStops,
  zoom,
  pan,
  projection = "flat",
  yaw = 0,
  pitch = 0,
  fov = (65 * Math.PI) / 180,
  style,
  className
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const exposureRef = useRef(exposureStops);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const projectionRef = useRef(projection);
  const yawRef = useRef(yaw);
  const pitchRef = useRef(pitch);
  const fovRef = useRef(fov);
  exposureRef.current = exposureStops;
  zoomRef.current = zoom;
  panRef.current = pan;
  projectionRef.current = projection;
  yawRef.current = yaw;
  pitchRef.current = pitch;
  fovRef.current = fov;

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
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      data.width,
      data.height,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      data.data
    );
    // Half-float filtering is core in WebGL2. Mipmaps need EXT_color_buffer_float
    // and keep the maximum-resolution source clean when it is minified.
    const floatTargets = gl.getExtension("EXT_color_buffer_float");
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      floatTargets ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (floatTargets) gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(gl.getUniformLocation(program, "uHdr"), 0);

    const uniforms = {
      exposure: gl.getUniformLocation(program, "uExposure"),
      zoom: gl.getUniformLocation(program, "uZoom"),
      pan: gl.getUniformLocation(program, "uPan"),
      canvas: gl.getUniformLocation(program, "uCanvas"),
      image: gl.getUniformLocation(program, "uImage"),
      scale: gl.getUniformLocation(program, "uScale"),
      equirect: gl.getUniformLocation(program, "uEquirect"),
      forward: gl.getUniformLocation(program, "uForward"),
      right: gl.getUniformLocation(program, "uRight"),
      up: gl.getUniformLocation(program, "uUp"),
      tanHalfFov: gl.getUniformLocation(program, "uTanHalfFov")
    };

    const draw = (): void => {
      gl.useProgram(program);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.viewport(0, 0, element.width, element.height);
      const scale = element.clientWidth > 0 ? element.width / element.clientWidth : 1;
      gl.uniform1f(uniforms.exposure, Math.pow(2, exposureRef.current));
      gl.uniform1f(uniforms.zoom, zoomRef.current);
      gl.uniform2f(uniforms.pan, panRef.current.x, panRef.current.y);
      gl.uniform2f(uniforms.canvas, element.width, element.height);
      gl.uniform2f(uniforms.image, data.width, data.height);
      gl.uniform1f(uniforms.scale, scale);
      gl.uniform1i(uniforms.equirect, projectionRef.current === "equirect" ? 1 : 0);
      const cp = Math.cos(pitchRef.current);
      const sp = Math.sin(pitchRef.current);
      const cy = Math.cos(yawRef.current);
      const sy = Math.sin(yawRef.current);
      gl.uniform3f(uniforms.forward, sy * cp, sp, -cy * cp);
      gl.uniform3f(uniforms.right, cy, 0, sy);
      gl.uniform3f(uniforms.up, -sy * sp, cp, cy * sp);
      gl.uniform1f(uniforms.tanHalfFov, Math.tan(fovRef.current / 2));
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

    const observer = new ResizeObserver(() => fit());
    observer.observe(container);
    drawRef.current = draw;
    glRef.current = gl;
    programRef.current = program;
    fit();
    return () => {
      observer.disconnect();
      drawRef.current = null;
      glRef.current = null;
      programRef.current = null;
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [data]);

  useEffect(() => {
    drawRef.current?.();
  }, [exposureStops, zoom, pan, projection, yaw, pitch, fov]);

  return <canvas ref={canvas} className={`hdr-canvas ${className ?? ""}`.trim()} style={style} />;
}
