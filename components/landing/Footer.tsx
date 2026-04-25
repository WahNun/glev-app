import { TEXT_FAINT } from "./tokens";

/** Minimal legal footer, identical across landing pages. */
export default function LandingFooter() {
  return (
    <footer
      style={{
        fontSize: 12,
        color: TEXT_FAINT,
        display: "flex",
        gap: 8,
        justifyContent: "center",
        flexWrap: "wrap",
        marginTop: 24,
      }}
    >
      <a href="/impressum" style={{ color: TEXT_FAINT, textDecoration: "none" }}>
        Impressum
      </a>
      <span aria-hidden>·</span>
      <a href="/datenschutz" style={{ color: TEXT_FAINT, textDecoration: "none" }}>
        Datenschutz
      </a>
      <span aria-hidden>·</span>
      <a href="mailto:hello@glev.app" style={{ color: TEXT_FAINT, textDecoration: "none" }}>
        hello@glev.app
      </a>
    </footer>
  );
}
