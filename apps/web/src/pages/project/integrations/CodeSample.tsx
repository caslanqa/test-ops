import { useId } from 'react';
import { CopyButton } from '../../../components/CopyButton';

/** A titled code block with a copy button; the block is a labelled region so a keyboard can scroll it. */
export function CodeSample({ title, text, copyLabel }: { title: string; text: string; copyLabel: string }) {
  const id = useId();
  return (
    <>
      <div className="code-header">
        <span id={`${id}-label`} className="field-label">{title}</span>
        <CopyButton text={text} what={copyLabel} targetId={id} />
      </div>
      <pre id={id} className="code-block" tabIndex={0} role="region" aria-labelledby={`${id}-label`}>
        {text}
      </pre>
    </>
  );
}
