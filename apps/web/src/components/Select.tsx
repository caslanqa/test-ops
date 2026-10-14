import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Drop-down list used instead of the native <select>.
 *
 * Why: browsers draw a native select's list themselves. macOS centres it over the field, enlarges
 * it and uses the system theme; Firefox ignores most of the page's styling. This component opens
 * the list right under the field, at the field's width and in the app's theme, in every browser.
 *
 * It follows the WAI-ARIA "select-only combobox" pattern: the field is a combobox button that
 * keeps focus while the list is open, and aria-activedescendant points at the active option.
 * Keys: Enter, Space, Alt+Down or the arrows open it; the arrows, Home, End, PageUp and PageDown
 * move; typing jumps to the next option starting with those letters; Enter, Space, Tab and
 * Alt+Up choose; Escape closes without choosing.
 *
 * The API mirrors <select> so pages change as little as possible: the options are <option>
 * children, and onChange receives `{ target: { value } }` like a change event.
 */

interface SelectOption {
  value: string;
  label: string;
  disabled: boolean;
}

export interface SelectProps {
  id?: string;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  /** Like a required <select>: the form can't be submitted while the value is empty. */
  required?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** Reads the <option> children (including ones from .map() and conditionals) into plain data. */
function readOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children)
    .filter((child): child is ReactElement<{ value?: string; disabled?: boolean; children?: ReactNode }> =>
      isValidElement(child) && child.type === 'option',
    )
    .map((option) => ({
      value: String(option.props.value ?? ''),
      label: Children.toArray(option.props.children).join(''),
      disabled: Boolean(option.props.disabled),
    }));
}

/** Space between the field and its list, and the most of the screen the list may use. */
const GAP = 4;
const MAX_LIST_HEIGHT = 320;
/** Typed letters are combined into one search until the keyboard is idle this long. */
const TYPEAHEAD_RESET_MS = 600;

export function Select({
  id,
  value,
  onChange,
  children,
  className,
  disabled = false,
  required = false,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: SelectProps) {
  const options = readOptions(children);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: '', timer: 0 });
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-select`;
  const listId = `${generatedId}-list`;
  const optionId = (index: number) => `${generatedId}-option-${index}`;
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const enabledIndexes = options.flatMap((o, i) => (o.disabled ? [] : [i]));

  const openList = useCallback(
    (index?: number) => {
      if (disabled || options.length === 0) return;
      setActiveIndex(index ?? (selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? -1));
      setOpen(true);
    },
    [disabled, options.length, selectedIndex, enabledIndexes],
  );

  const close = useCallback(() => setOpen(false), []);

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange({ target: { value: option.value } });
    setOpen(false);
  }

  /** The next enabled option from `from` in direction `step`, staying at the ends. */
  function move(from: number, step: number) {
    let index = from;
    for (let i = 0; i < options.length; i++) {
      const next = index + step;
      if (next < 0 || next >= options.length) return index;
      index = next;
      if (!options[index].disabled) return index;
    }
    return from;
  }

  /** Jumps to the next option whose label starts with the letters typed so far. */
  function search(char: string): number {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += char.toLowerCase();
    state.timer = window.setTimeout(() => {
      state.text = '';
    }, TYPEAHEAD_RESET_MS);
    const start = open ? activeIndex : selectedIndex;
    // Repeating one letter cycles through the options that start with it.
    const repeated = state.text.split('').every((c) => c === state.text[0]);
    const needle = repeated ? state.text[0] : state.text;
    const order = [...options.keys()].map((i) => (start + 1 + i) % options.length);
    if (!repeated) order.unshift(Math.max(start, 0));
    return order.find((i) => !options[i].disabled && options[i].label.trim().toLowerCase().startsWith(needle)) ?? -1;
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const { key, altKey } = event;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        event.preventDefault();
        openList(key === 'ArrowUp' && !altKey && selectedIndex < 0 ? enabledIndexes.at(-1) : undefined);
      } else if (key === 'Home' || key === 'End') {
        event.preventDefault();
        openList(key === 'Home' ? enabledIndexes[0] : enabledIndexes.at(-1));
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !altKey) {
        const found = search(key);
        if (found >= 0) openList(found);
      }
      return;
    }
    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => move(i, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (altKey) choose(activeIndex);
        else setActiveIndex((i) => move(i, -1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(enabledIndexes[0] ?? -1);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(enabledIndexes.at(-1) ?? -1);
        break;
      case 'PageDown':
        event.preventDefault();
        setActiveIndex((i) => Array.from({ length: 10 }).reduce<number>((at) => move(at, 1), i));
        break;
      case 'PageUp':
        event.preventDefault();
        setActiveIndex((i) => Array.from({ length: 10 }).reduce<number>((at) => move(at, -1), i));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(activeIndex);
        break;
      case 'Tab':
        // Tab chooses the active option and lets focus move on.
        choose(activeIndex);
        break;
      case 'Escape':
        // Only the list closes; a dialog around the field stays open.
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      default:
        if (key.length === 1 && !event.ctrlKey && !event.metaKey && !altKey) {
          const found = search(key);
          if (found >= 0) setActiveIndex(found);
        }
    }
  }

  // The list lives in the top layer (popover) so a scrolling table or dialog can't clip it, and is
  // placed with fixed coordinates under the field; above it only when there's no room below.
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - GAP * 2;
    const above = rect.top - GAP * 2;
    const natural = Math.min(list.scrollHeight, MAX_LIST_HEIGHT);
    const openUp = below < natural && above > below;
    const height = Math.min(natural, openUp ? above : below);
    list.style.left = `${rect.left}px`;
    list.style.width = `${rect.width}px`;
    list.style.maxHeight = `${Math.max(height, 0)}px`;
    list.style.top = openUp ? `${rect.top - GAP - height}px` : `${rect.bottom + GAP}px`;
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (open) {
      // The list is named after the field's visible label (or its aria-label), as in the pattern.
      const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(triggerId)}"]`);
      if (label) {
        if (!label.id) label.id = `${triggerId}-label`;
        list.setAttribute('aria-labelledby', label.id);
      } else if (ariaLabel) {
        list.setAttribute('aria-label', ariaLabel);
      }
      if (!list.matches(':popover-open')) list.showPopover();
      place();
    } else if (list.matches(':popover-open')) {
      list.hidePopover();
    }
  }, [open, place, triggerId, ariaLabel]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !listRef.current?.contains(target)) close();
    };
    // Scrolling the page moves the field, so the list follows it; resizing does the same.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, place, close]);

  // Keeps the active option in view while moving through a long list.
  useEffect(() => {
    if (open && activeIndex >= 0) {
      document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
    }
    // optionId only depends on the stable generated id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex]);

  return (
    <span className="select">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        className={`select-trigger${className ? ` ${className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // Focus leaving for anything but the list (e.g. a click elsewhere) closes it.
          if (!listRef.current?.contains(event.relatedTarget as Node)) close();
        }}
      >
        <span className="select-value">{selected?.label ?? ''}</span>
        <ChevronDown size={16} aria-hidden="true" className="select-icon" />
      </button>
      {required && (
        // A native field the browser checks on submit, so a required list behaves like a required
        // <select>; it is invisible and hands focus straight back to the visible field.
        <input
          className="select-validation"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => undefined}
          onFocus={() => triggerRef.current?.focus()}
        />
      )}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        popover="manual"
        className="select-list"
        tabIndex={-1}
      >
        {options.map((option, index) => (
          <li
            key={`${option.value}-${index}`}
            id={optionId(index)}
            role="option"
            className={`select-option${index === activeIndex ? ' is-active' : ''}`}
            aria-selected={index === selectedIndex}
            aria-disabled={option.disabled || undefined}
            // Keeps focus on the field while clicking, as the pattern requires.
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => !option.disabled && activeIndex !== index && setActiveIndex(index)}
            onClick={() => choose(index)}
          >
            <Check size={14} aria-hidden="true" className="select-check" />
            <span>{option.label}</span>
          </li>
        ))}
      </ul>
    </span>
  );
}
