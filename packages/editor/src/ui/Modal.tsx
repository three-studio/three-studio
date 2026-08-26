import type { ReactNode } from 'react';
import { DialogFrame } from './DialogFrame';

export { Field } from './DialogFrame';

export interface ModalSection {
  id: string;
  label: string;
  /** Grouping heading above this entry in the list. */
  group?: string;
}

interface ModalProps {
  title: string;
  sections: readonly ModalSection[];
  activeSection: string;
  onSelectSection: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
  /** Buttons along the bottom right. */
  footer?: ReactNode;
}

/**
 * A large dialog with a section list down the left, as both Unity and Unreal
 * present anything with more than a handful of settings.
 *
 * The frame around it — backdrop, title bar, Escape, footer — is `DialogFrame`,
 * shared with the dialogs whose left column is not a section list.
 */
export function Modal({
  title,
  sections,
  activeSection,
  onSelectSection,
  onClose,
  children,
  footer,
}: ModalProps) {
  let lastGroup: string | undefined;

  return (
    <DialogFrame title={title} onClose={onClose} footer={footer}>
      <nav className="w-52 shrink-0 overflow-y-auto border-r border-line bg-surface-0/40 py-2">
        {sections.map((section) => {
          const heading = section.group !== lastGroup ? section.group : undefined;
          lastGroup = section.group;
          return (
            <div key={section.id}>
              {heading && (
                <p className="px-3 pb-1 pt-3 text-2xs uppercase tracking-wide text-ink-dim">
                  {heading}
                </p>
              )}
              <button
                type="button"
                onClick={() => onSelectSection(section.id)}
                className={`w-full px-3 py-1.5 text-left text-2xs ${
                  activeSection === section.id
                    ? 'bg-accent-dim text-ink'
                    : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {section.label}
              </button>
            </div>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto p-5">{children}</div>
    </DialogFrame>
  );
}
