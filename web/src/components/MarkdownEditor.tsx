import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";

// Obsidian's source mode, in Jarvis's colors: the text stays the markdown I write, only styled. The theme reads the
// CSS variables, so light and dark follow the app's toggle without a second theme.
const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.45em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.25em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.1em", fontWeight: "700" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: [tags.link, tags.url], color: "var(--accent)", textDecoration: "underline" },
  { tag: tags.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "var(--accent)" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "var(--muted)" },
  { tag: tags.list, color: "var(--accent)" },
]);

const theme = EditorView.theme({
  "&": {
    color: "var(--ink)",
    backgroundColor: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "0.5rem",
    fontSize: "15px",
  },
  "&.cm-focused": { outline: "none", borderColor: "var(--accent)" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.65" },
  ".cm-content": { padding: "1rem", caretColor: "var(--accent)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)" },
});

const extensions = [markdown(), syntaxHighlighting(highlight), theme, EditorView.lineWrapping];

export const MarkdownEditor = ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) => (
  <CodeMirror
    value={value}
    onChange={onChange}
    extensions={extensions}
    theme="none"
    minHeight="60vh"
    aria-label={label}
    basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLineGutter: false, autocompletion: false }}
  />
);
