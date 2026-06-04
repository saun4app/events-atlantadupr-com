import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { Link } from "@tiptap/extension-link";
import { useEffect, useCallback, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Bold as BoldIcon, Underline as UnderlineIcon, Italic as ItalicIcon, Palette, Link as LinkIcon, Unlink, List, ListOrdered } from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  "data-testid"?: string;
}

export function RichTextEditor({ value, onChange, placeholder, "data-testid": testId }: RichTextEditorProps) {
  const [linkUrl, setLinkUrl] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const savedSelection = useRef<{ from: number; to: number } | null>(null);
  const colorSelectionRef = useRef<{ from: number; to: number } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false }),
      TextStyle,
      Color,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
    editorProps: {
      attributes: {
        class: "min-h-[100px] px-3 py-2 text-sm focus:outline-none prose prose-sm max-w-none leading-snug [&_p]:my-0.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const editorHtml = editor.getHTML();
    const normalize = (v: string) => (v === "<p></p>" ? "" : v);
    if (normalize(value) !== normalize(editorHtml)) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  const handleColorChange = useCallback((color: string) => {
    if (!editor) return;
    const sel = colorSelectionRef.current;
    if (sel && sel.from !== sel.to) {
      editor.chain()
        .setTextSelection({ from: sel.from, to: sel.to })
        .setColor(color)
        .run();
    } else {
      // Caret (collapsed selection) or no saved selection — set color for future typing
      editor.chain().focus().setColor(color).run();
    }
    colorSelectionRef.current = null;
  }, [editor]);

  function openLinkInput() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    // If no text selected, extend to cover the full link mark span
    if (from === to) {
      editor.chain().extendMarkRange("link").run();
    }
    const { from: extFrom, to: extTo } = editor.state.selection;
    savedSelection.current = { from: extFrom, to: extTo };
    const existing = editor.getAttributes("link").href as string | undefined;
    setLinkUrl(existing ?? "");
    setShowLinkInput(true);
  }

  function applyLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    const sel = savedSelection.current;
    const href = url ? (url.startsWith("http") ? url : `https://${url}`) : null;

    savedSelection.current = null;
    setShowLinkInput(false);
    setLinkUrl("");

    if (!sel || sel.from === sel.to) return;

    const { state, dispatch } = editor.view;
    const linkMark = state.schema.marks.link;
    if (!linkMark) return;

    const tr = state.tr.removeMark(sel.from, sel.to, linkMark);
    if (href) {
      tr.addMark(sel.from, sel.to, linkMark.create({ href, target: "_blank", rel: "noopener noreferrer" }));
    }
    dispatch(tr);
    editor.commands.focus();
  }

  function removeLink() {
    if (!editor) return;
    // Extend to the full link mark range first, then remove
    editor.chain().extendMarkRange("link").run();
    const { from, to } = editor.state.selection;
    const { state, dispatch } = editor.view;
    const linkMark = state.schema.marks.link;
    if (!linkMark) return;
    dispatch(state.tr.removeMark(from, to, linkMark));
    editor.commands.focus();
    setShowLinkInput(false);
  }

  if (!editor) return null;

  let currentHeading = "0";
  for (let i = 1; i <= 6; i++) {
    if (editor.isActive("heading", { level: i })) {
      currentHeading = String(i);
      break;
    }
  }

  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) ?? "";
  const isLink = editor.isActive("link");

  function handleHeadingChange(val: string) {
    if (!editor) return;
    if (val === "0") {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().setHeading({ level: Number(val) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    }
  }

  return (
    <div className="border border-input rounded-md overflow-hidden bg-background" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30">
        <select
          value={currentHeading}
          onChange={e => handleHeadingChange(e.target.value)}
          title="Heading level"
          className="h-7 rounded bg-transparent text-xs text-muted-foreground hover:bg-muted cursor-pointer focus:outline-none px-1.5 border border-transparent hover:border-border"
        >
          <option value="0">Normal</option>
          <option value="1">H1</option>
          <option value="2">H2</option>
          <option value="3">H3</option>
          <option value="4">H4</option>
          <option value="5">H5</option>
          <option value="6">H6</option>
        </select>

        <div className="w-px h-4 bg-border mx-0.5" />

        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <BoldIcon className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <ItalicIcon className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <UnderlineIcon className="w-3.5 h-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-0.5" />

        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-0.5" />

        <ToolbarButton active={isLink} onClick={openLinkInput} title="Insert / edit link">
          <LinkIcon className="w-3.5 h-3.5" />
        </ToolbarButton>
        {isLink && (
          <ToolbarButton active={false} onClick={removeLink} title="Remove link">
            <Unlink className="w-3.5 h-3.5" />
          </ToolbarButton>
        )}

        <div className="w-px h-4 bg-border mx-0.5" />

        <div className="relative flex items-center">
          <button
            type="button"
            title="Text color"
            className={cn(
              "p-1 rounded flex flex-col items-center gap-0.5 transition-colors",
              "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Palette className="w-3.5 h-3.5" />
            <span
              className="block w-3.5 h-0.5 rounded-full"
              style={{ backgroundColor: currentColor || "#94a3b8" }}
            />
          </button>
          <input
            type="color"
            value={currentColor || "#000000"}
            onMouseDown={() => {
              if (editor) {
                const { from, to } = editor.state.selection;
                colorSelectionRef.current = { from, to };
              }
            }}
            onChange={e => handleColorChange(e.target.value)}
            tabIndex={-1}
            title="Text color"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </div>
      </div>

      {showLinkInput && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
          <input
            autoFocus
            type="url"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") { setShowLinkInput(false); } }}
            placeholder="https://example.com"
            className="flex-1 text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={applyLink} className="text-xs font-medium text-primary hover:underline shrink-0">Apply</button>
          <button type="button" onClick={() => setShowLinkInput(false)} className="text-xs text-muted-foreground hover:text-foreground shrink-0">Cancel</button>
        </div>
      )}

      <div
        style={{ resize: "vertical", overflow: "auto", minHeight: "120px" }}
        className="relative"
      >
        {!editor.getText() && placeholder && (
          <p className="absolute top-2 left-3 text-sm text-muted-foreground pointer-events-none select-none">
            {placeholder}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "p-1 rounded text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
