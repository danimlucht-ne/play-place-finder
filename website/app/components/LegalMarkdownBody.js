import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function LegalMarkdownBody({ content }) {
  return (
    <div className="legal-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
