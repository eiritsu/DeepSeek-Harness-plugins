/** Browse localized category groups and commit one category slug. */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react'
import { MenuSurface, useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CategoryCascader.module.css'
import { useMenuEscape } from './useMenuEscape.ts'

/** One named category option with its source-provided domain label. */
export interface CategoryOption { readonly slug: string; readonly name: string; readonly group?: string }

/** Props for a domain-to-category picker backed by Host taxonomy. */
export interface CategoryCascaderProps {
  readonly label: string
  readonly value: string
  readonly options: readonly CategoryOption[]
  readonly allLabel: string
  readonly otherGroupLabel: string
  readonly searchLabel: string
  readonly noResultsLabel: string
  readonly domainsLabel: string
  readonly categoriesLabel: string
  readonly backLabel: string
  readonly onChange: (slug: string) => void
}

/** Unplaced panel geometry: hidden but laid out so the anchored hook measures real dimensions. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/**
 * Render a searchable two-level category picker without showing internal slugs.
 *
 * The panel is fixed to the viewport and placed from the trigger, so an
 * ancestor's `overflow` cannot crop it while the trigger stays in flow. Each
 * row shows only its own name; the source domain stays on search results, where
 * several domains can appear together, as part of the row's accessible name.
 */
export function CategoryCascader({
  label,
  value,
  options,
  allLabel,
  otherGroupLabel,
  searchLabel,
  noResultsLabel,
  domainsLabel,
  categoriesLabel,
  backLabel,
  onChange,
}: CategoryCascaderProps) {
  const id = useId().replaceAll(':', '')
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState<string>()
  const [activeIndex, setActiveIndex] = useState(0)
  const groups = useMemo(() => {
    const result = new Map<string, CategoryOption[]>()
    for (const option of options) {
      const name = option.group ?? otherGroupLabel
      const children = result.get(name) ?? []
      children.push(option)
      result.set(name, children)
    }
    return [...result.entries()]
  }, [options, otherGroupLabel])
  const selected = options.find(option => option.slug === value)
  const selectedName = selected?.name ?? allLabel
  const currentOptions = group === undefined ? [] : groups.find(([name]) => name === group)?.[1] ?? []
  const needle = search.trim().toLocaleLowerCase()
  const searchMatches = needle === '' ? [] : options.filter(option => (
    option.name.toLocaleLowerCase().includes(needle)
    || option.group?.toLocaleLowerCase().includes(needle) === true
  ))
  const entries = needle !== '' ? searchMatches : group === undefined ? groups.map(([name]) => ({ slug: name, name })) : currentOptions
  const activeEntry = entries[activeIndex]
  const position = useAnchoredPosition({ open, anchorRef: triggerRef, panelRef: menuRef, gap: 4, margin: 12 })

  useEffect(() => { if (open) searchRef.current?.focus() }, [open])
  const close = (): void => { setOpen(false); setSearch(''); setGroup(undefined) }
  useMenuEscape(open, () => { close(); triggerRef.current?.focus() })
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && containerRef.current?.contains(event.relatedTarget) === true) return
    close()
  }
  const choose = (slug: string): void => { onChange(slug); close() }
  const enterGroup = (name: string): void => { setGroup(name); setSearch(''); setActiveIndex(0) }
  const back = (): void => { setGroup(undefined); setSearch(''); setActiveIndex(0) }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(index => Math.min(index + 1, entries.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
    } else if (event.key === 'ArrowRight' && needle === '' && group === undefined && activeEntry !== undefined) {
      event.preventDefault()
      enterGroup(activeEntry.name)
    } else if (event.key === 'ArrowLeft' && needle === '' && group !== undefined) {
      event.preventDefault()
      back()
    } else if (event.key === 'Enter' && activeEntry !== undefined) {
      event.preventDefault()
      if (needle !== '') choose(activeEntry.slug)
      else if (group === undefined) enterGroup(activeEntry.name)
      else choose(activeEntry.slug)
    }
  }

  return <div ref={containerRef} className={css.categorySelect} onBlur={onBlur}>
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-label={`${label}: ${selectedName}`}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={`${id}-list`}
      className={css.trigger}
      onClick={() => { setOpen(true); setSearch(''); setGroup(undefined); setActiveIndex(0) }}
    >
      <span>{selectedName}</span><span aria-hidden="true">⌄</span>
    </button>
    {open ? <MenuSurface ref={menuRef} compact className={css.menu} style={position ?? MEASURE_STYLE}>
      <div className={css.searchRow}>
        <input
          ref={searchRef}
          type="search"
          role="searchbox"
          aria-label={searchLabel}
          aria-controls={`${id}-list`}
          aria-activedescendant={entries[activeIndex] === undefined ? undefined : `${id}-option-${activeIndex}`}
          placeholder={searchLabel}
          value={search}
          onChange={(event) => { setSearch(event.currentTarget.value); setActiveIndex(0) }}
          onKeyDown={onKeyDown}
        />
        <button type="button" className={css.clear} onMouseDown={(event) => { event.preventDefault() }} onClick={() => { choose('') }}>{allLabel}</button>
      </div>
      {group !== undefined && needle === '' ? <button type="button" className={css.back} onMouseDown={(event) => { event.preventDefault() }} onClick={back}>{backLabel}</button> : null}
      <div id={`${id}-list`} role="listbox" aria-label={needle !== '' || group !== undefined ? categoriesLabel : domainsLabel} className={css.list}>
        {entries.map((entry, index) => {
          const isDomain = needle === '' && group === undefined
          const name = entry.name
          const slug = isDomain ? undefined : entry.slug
          const groupName = 'group' in entry ? entry.group : undefined
          const showGroup = !isDomain && needle !== '' && groupName !== undefined
          return <button
            key={isDomain ? `domain:${name}` : `category:${entry.slug}`}
            id={`${id}-option-${index}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-label={showGroup ? `${name}, ${groupName}` : name}
            aria-selected={slug !== undefined && slug === value}
            data-active={index === activeIndex || undefined}
            className={css.option}
            onMouseDown={(event) => { event.preventDefault() }}
            onClick={() => { if (isDomain) enterGroup(name); else choose(entry.slug) }}
          >
            <span className={css.optionName}>{name}</span>
          </button>
        })}
        {entries.length === 0 ? <p className={css.empty} role="status">{noResultsLabel}</p> : null}
      </div>
    </MenuSurface> : null}
  </div>
}
