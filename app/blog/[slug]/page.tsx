import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchSoroArticles } from "@/lib/soro-rss";
import GlevLockup from "@/components/GlevLockup";

export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  const articles = await fetchSoroArticles().catch(() => []);
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const articles = await fetchSoroArticles().catch(() => []);
  const article = articles.find((a) => a.slug === slug);
  if (!article) return {};

  const url = `https://glev.app/blog/${slug}`;
  return {
    title: `${article.title} — Glev Blog`,
    description: article.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: article.title,
      description: article.description,
      publishedTime: article.pubDate ? new Date(article.pubDate).toISOString() : undefined,
      siteName: "Glev",
    },
    twitter: {
      card: "summary_large_image",
      title: `${article.title} — Glev Blog`,
      description: article.description,
    },
  };
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;
  const articles = await fetchSoroArticles().catch(() => []);
  const article = articles.find((a) => a.slug === slug);
  if (!article) notFound();

  const pubDateFormatted = article.pubDate
    ? new Date(article.pubDate).toLocaleDateString("de-DE", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const BORDER = "var(--border)";

  return (
    <main
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        minHeight: "100dvh",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
        paddingTop: "var(--marketing-header-total)",
      }}
    >
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "color-mix(in srgb, var(--bg) 72%, transparent)",
          backdropFilter: "saturate(180%) blur(14px)",
          WebkitBackdropFilter: "saturate(180%) blur(14px)",
          borderBottom: `1px solid ${BORDER}`,
          paddingTop: "var(--safe-top)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            maxWidth: 1180,
            margin: "0 auto",
            padding: "14px 24px",
          }}
        >
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }} aria-label="Glev Home">
            <GlevLockup size={28} />
          </Link>
          <Link
            href="/blog"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              textDecoration: "none",
              padding: "9px 16px",
              borderRadius: 999,
              border: `1px solid ${BORDER}`,
              background: "var(--surface-soft)",
            }}
          >
            ← Blog
          </Link>
        </div>
      </nav>

      <article
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "48px 24px 80px",
        }}
      >
        <header style={{ marginBottom: 32 }}>
          <h1
            style={{
              fontSize: 36,
              lineHeight: 1.2,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              margin: "0 0 12px",
              hyphens: "auto",
              overflowWrap: "break-word",
            }}
          >
            {article.title}
          </h1>
          {pubDateFormatted && (
            <time
              dateTime={new Date(article.pubDate).toISOString()}
              style={{ fontSize: 13, color: "var(--text-dim, #94a3b8)" }}
            >
              {pubDateFormatted}
            </time>
          )}
        </header>

        <style>{`
          .soro-article-content, .soro-article-content * {
            color: var(--text) !important;
            background: transparent !important;
            border-color: var(--border) !important;
          }
          .soro-article-content h1,
          .soro-article-content h2,
          .soro-article-content h3,
          .soro-article-content h4 { font-weight: 700 !important; margin: 1.5em 0 0.5em; }
          .soro-article-content p { margin: 0 0 1em; line-height: 1.7; }
          .soro-article-content a { color: #6B8BFF !important; text-decoration: underline; }
          .soro-article-content a:hover { color: #9DB3FF !important; }
          .soro-article-content img { max-width: 100%; border-radius: 8px; }
          .soro-article-content code,
          .soro-article-content pre {
            background: var(--surface-soft) !important;
            border: 1px solid var(--border) !important;
            border-radius: 6px;
            font-size: 0.875em;
          }
          .soro-article-content pre { padding: 12px 16px; overflow-x: auto; }
          .soro-article-content blockquote {
            border-left: 3px solid var(--border-strong, #444) !important;
            color: var(--text-dim, #c7c7c7) !important;
            margin: 0 0 1em;
            padding-left: 14px;
          }
        `}</style>

        <div
          className="soro-article-content"
          dangerouslySetInnerHTML={{ __html: article.content || article.description }}
        />
      </article>
    </main>
  );
}
