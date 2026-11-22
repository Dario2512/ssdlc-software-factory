// Runs after `node src/build.mjs` (see `npm test`). Checks the built site, not the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml, loadPosts, renderMarkdown } from "../src/build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return p.endsWith(".html") ? [p] : [];
  });
}

test("every post has a built page and appears on the home page", () => {
  const index = readFileSync(join(OUT, "index.html"), "utf8");
  const posts = loadPosts();
  assert.ok(posts.length > 0, "there should be at least one post");
  for (const post of posts) {
    assert.ok(existsSync(join(OUT, "posts", `${post.slug}.html`)), `missing page for ${post.slug}`);
    assert.ok(index.includes(`posts/${post.slug}.html`), `home page does not link ${post.slug}`);
  }
});

test("every internal link and stylesheet resolves to a built file", () => {
  for (const file of htmlFiles(OUT)) {
    const html = readFileSync(file, "utf8");
    for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https:|mailto:|#)/.test(url)) continue;
      const target = resolve(dirname(file), url.split("#")[0]);
      assert.ok(existsSync(target), `${relative(OUT, file)} links to missing ${url}`);
    }
  }
});

test("no page ships JavaScript, inline handlers or insecure links", () => {
  for (const file of htmlFiles(OUT)) {
    const html = readFileSync(file, "utf8");
    const name = relative(OUT, file);
    assert.doesNotMatch(html, /<script/i, `${name} contains a <script>`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${name} contains an inline event handler`);
    assert.doesNotMatch(html, /(href|src)="(javascript:|data:|http:)/i, `${name} has an unsafe URL`);
    assert.match(html, /Content-Security-Policy/, `${name} is missing its CSP`);
  }
});

test("every page has a title and a description", () => {
  for (const file of htmlFiles(OUT)) {
    const html = readFileSync(file, "utf8");
    assert.match(html, /<title>[^<]+<\/title>/, `${relative(OUT, file)} has no title`);
    assert.match(html, /<meta name="description" content="[^"]+">/, `${relative(OUT, file)} has no description`);
  }
});

test("raw HTML and unsafe links in markdown are neutralised", () => {
  const html = renderMarkdown('Hi <script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) [ok](https://example.org)');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img src=x/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /href="https:\/\/example.org" rel="noopener noreferrer"/);
  assert.equal(escapeHtml('<b a="1">'), "&lt;b a=&quot;1&quot;&gt;");
});
