import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Bold as BoldIcon, Underline as UnderlineIcon, Italic as ItalicIcon, Palette } from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  "data-testid"?: string;
}

export function RichTextEditor({ value, onChange, placeholder, "data-testid": testId }: RichTextEditorProps) {
  const colorInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      TextStyle,
      Color,
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
    editorProps: {
      attributes: {
        class: "min-h-[100px] px-3 py-2 text-sm focus:outline-none prose prose-sm max-w-none",
      },
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  const handleColorChange = useCallback((color: string) => {
    if (!editor) return;
    editor.chain().focus().setColor(color).run();
  }, [editor]);

  if (!editor) return null;

  let currentHeading = "0";
  for (let i = 1; i <= 6; i++) {
    if (editor.isActive("heading", { level: i })) {
      currentHeading = String(i);
      break;
    }
  }

  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) ?? "";

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

        <div className="relative flex items-center">
          <input
            ref={colorInputRef}
            type="color"
            value={currentColor || "#000000"}
            onChange={e => handleColorChange(e.target.value)}
            className="sr-only"
            tabIndex={-1}
          />
          <button
            type="button"
            title="Text color"
            onClick={() => colorInputRef.current?.click()}
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
        </div>
      </div>
      <div className="relative">
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
