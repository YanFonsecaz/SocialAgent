import { createMemo } from "solid-js";
import DOMPurify from "dompurify";
import { marked } from "marked";

type MarkdownContentProps = {
    markdown: string;
    className?: string;
};

export function MarkdownContent(props: MarkdownContentProps) {
    const html = createMemo(() => {
        const rawHtml = marked.parse(props.markdown ?? "", {
            gfm: true,
            breaks: true,
        });
        return DOMPurify.sanitize(String(rawHtml));
    });

    return <div class={props.className} innerHTML={html()} />;
}
