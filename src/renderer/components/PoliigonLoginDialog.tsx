import { useEffect } from "react";
import { CloseIcon, UserIcon } from "../icons";
import { usePoliigonStore } from "../poliigon-store";

export function PoliigonLoginDialog() {
  const open = usePoliigonStore(state => state.loginOpen);
  const busy = usePoliigonStore(state => state.loginBusy);
  const browser = usePoliigonStore(state => state.loginBrowser);
  const error = usePoliigonStore(state => state.loginError);
  const close = usePoliigonStore(state => state.closeLogin);
  const loginBrowser = usePoliigonStore(state => state.loginBrowserFlow);
  const cancelBrowser = usePoliigonStore(state => state.cancelBrowserLogin);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, open]);

  if (!open) return null;

  return (
    <div
      className="busy-overlay poliigon-login-overlay"
      role="presentation"
      onClick={event => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="busy-card poliigon-login-card" role="dialog" aria-modal="true" aria-label="Sign in to Poliigon">
        <button type="button" className="icon-btn poliigon-login-close" onClick={close} aria-label="Close">
          <CloseIcon />
        </button>

        <div className="poliigon-login-heading">
          <div className="avatar small"><UserIcon /></div>
          <div>
            <h2>Sign in to Poliigon</h2>
            <p>Download free and owned assets, and keep your library in sync.</p>
          </div>
        </div>

        {busy && browser ? (
          <div className="poliigon-browser-wait" role="status">
            <div className="spinner" />
            <strong>Waiting for Poliigon sign-in…</strong>
            <p>Complete the sign-in in the browser window that just opened.</p>
            <button type="button" className="btn btn-ghost" onClick={() => void cancelBrowser()}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="poliigon-login-panel">
            <p>
              Poliigon opens its own secure sign-in page in your browser. OpenBridge never sees
              or stores your password.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-wide"
              disabled={busy}
              onClick={() => void loginBrowser()}
            >
              {busy ? "Opening…" : "Open Poliigon sign-in"}
            </button>
            <p className="hint">
              Poliigon currently requires browser sign-in for addon/API sessions. It works with
              two-factor authentication and SSO.
            </p>
          </div>
        )}

        {error && <div className="error-box small" role="alert">{error}</div>}

        <p className="hint">
          OpenBridge stores only the access token, encrypted with Windows DPAPI.
        </p>
      </div>
    </div>
  );
}
