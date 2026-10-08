/**
 * Pick one occupation inside the occupation field's own dropdown menu: the
 * menu is anchored to the field and portaled to `document.body`, and the major
 * → occupation group → occupation levels convert in place as the user drills
 * in and back out. Host taxonomy supplies every row, count, and SOC code; the
 * committed value is the occupation slug while the field shows localized
 * names.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCheckOutlineRegular, MenuSurface, useAnchoredPosition, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsMpTaxonomy, SkillsMpTaxonomyOccupation } from '@deepseek-ai/dsh-community-skill-catalog/types'
import css from './SkillCatalogPage.module.css'
import { useMenuEscape } from './useMenuEscape.ts'

/** Localized labels and the selected occupation slug. */
export interface OccupationCascaderProps {
  /** Localized field name, used in the trigger's accessible name. */
  readonly label: string
  /** Committed occupation slug; empty shows every occupation. */
  readonly value: string
  /** Host taxonomy supplying every level, count, and SOC code. */
  readonly taxonomy: SkillsMpTaxonomy
  /** Trigger text while no occupation is committed. */
  readonly allLabel: string
  /** Accessible name of the menu. */
  readonly pickerTitle: string
  /** Accessible description of the menu. */
  readonly pickerDescription: string
  /** Placeholder and accessible name of the in-menu search field. */
  readonly searchLabel: string
  /** Text shown by a level with no row to offer. */
  readonly noResultsLabel: string
  /** Name of the major-group list. */
  readonly majorGroupsLabel: string
  /** Accessible name of the control that commits a group instead of drilling into it. */
  readonly selectGroupLabel: (name: string) => string
  /** Accessible name of the control that collapses the drilled group. */
  readonly collapseGroupLabel: (name: string) => string
  /** Accessible name of the control that expands the highlighted group. */
  readonly expandGroupLabel: (name: string) => string
  /** Text of the control that clears the committed occupation. */
  readonly clearSelectionLabel: string
  /**
   * Catalog-wide dismissal label. The menu closes on Escape, an outside pointer, or the field itself,
   * so it names no control of its own.
   */
  readonly closeLabel: string
  /** Commit one occupation slug; empty clears the filter. */
  readonly onChange: (slug: string) => void
}

/** Distance between the field and the menu, matching the shared Menu primitive. */
const GAP = 4
/** Viewport margin kept clear of the menu on every side. */
const MARGIN = 12
/** Unplaced menu: laid out at the origin so the placement pass measures real dimensions. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }
/** List identifiers for the three browse levels and the search results. */
const LEVELS = ['major', 'minor', 'occupation'] as const
/** List identifier of the search results. */
const SEARCH = 'search'
/** Drill level of a row that commits its own slug instead of opening a level. */
const COMMIT = -1

/** One row of the menu. */
interface Entry {
  /** Taxonomy node behind the row. */
  readonly node: SkillsMpTaxonomyOccupation
  /** Level the row opens, or {@link COMMIT} to commit the row itself. */
  readonly level: number
  /** Localized ancestor names above the row, shown only by a search hit. */
  readonly trail: readonly string[]
}

/** Return ancestors from the root while stopping safely if Host data cycles. */
function ancestorsFor(
  node: SkillsMpTaxonomyOccupation,
  bySlug: ReadonlyMap<string, SkillsMpTaxonomyOccupation>,
): readonly SkillsMpTaxonomyOccupation[] {
  const ancestors: SkillsMpTaxonomyOccupation[] = []
  const seen = new Set([node.slug])
  let parentId = node.parentId
  while (parentId !== undefined && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = bySlug.get(parentId)
    if (parent === undefined) break
    ancestors.unshift(parent)
    parentId = parent.parentId
  }
  return ancestors
}

/** Return whether a node descends from the requested taxonomy slug. */
function descendsFrom(
  node: SkillsMpTaxonomyOccupation,
  ancestorSlug: string,
  bySlug: ReadonlyMap<string, SkillsMpTaxonomyOccupation>,
): boolean {
  const seen = new Set<string>()
  let parentId = node.parentId
  while (parentId !== undefined && !seen.has(parentId)) {
    if (parentId === ancestorSlug) return true
    seen.add(parentId)
    parentId = bySlug.get(parentId)?.parentId
  }
  return false
}

/** Keep level-three taxonomy labels internal while showing major, minor, and occupation names. */
function displayPath(path: readonly SkillsMpTaxonomyOccupation[]): readonly SkillsMpTaxonomyOccupation[] {
  return path.filter(node => node.level === 1 || node.level === 2 || node.level === 4)
}

/** Compare SOC codes segment by segment so `15-2` precedes `15-10`. */
function compareCodes(left: string, right: string): number {
  const leftSegments = left.split('-')
  const rightSegments = right.split('-')
  for (let index = 0; index < Math.max(leftSegments.length, rightSegments.length); index += 1) {
    const leftValue = Number(leftSegments[index])
    const rightValue = Number(rightSegments[index])
    if (Number.isNaN(leftValue) || Number.isNaN(rightValue)) return left < right ? -1 : left > right ? 1 : 0
    if (leftValue !== rightValue) return leftValue - rightValue
  }
  return 0
}

/** One taxonomy node paired with the SOC code the ordering reads, so the sort never re-reads an optional field. */
interface CodedOccupation {
  readonly code: string
  readonly node: SkillsMpTaxonomyOccupation
}

/** Order one level by its source SOC code; nodes without a code keep their source order behind the coded ones. */
function bySourceCode(nodes: readonly SkillsMpTaxonomyOccupation[]): readonly SkillsMpTaxonomyOccupation[] {
  const coded: CodedOccupation[] = []
  const uncoded: SkillsMpTaxonomyOccupation[] = []
  for (const node of nodes) {
    const code = node.code
    if (code === undefined) uncoded.push(node)
    else coded.push({ code, node })
  }
  coded.sort((left, right) => compareCodes(left.code, right.code))
  return [...coded.map(entry => entry.node), ...uncoded]
}

/** Render the field-anchored occupation menu with drillable levels, local search, and one committed slug. */
export function OccupationCascader({
  label,
  value,
  taxonomy,
  allLabel,
  pickerTitle,
  pickerDescription,
  searchLabel,
  noResultsLabel,
  majorGroupsLabel,
  selectGroupLabel,
  collapseGroupLabel,
  expandGroupLabel,
  clearSelectionLabel,
  onChange,
}: OccupationCascaderProps) {
  const id = useId().replaceAll(':', '')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [majorSlug, setMajorSlug] = useState('')
  const [minorSlug, setMinorSlug] = useState('')
  const [active, setActive] = useState(0)
  const occupations = taxonomy.occupations
  const bySlug = useMemo(() => new Map(occupations.map(occupation => [occupation.slug, occupation])), [occupations])
  const majors = useMemo(() => bySourceCode(occupations.filter(occupation => occupation.level === 1)), [occupations])
  const major = majorSlug === '' ? undefined : majors.find(node => node.slug === majorSlug)
  const minors = useMemo(() => major === undefined
    ? []
    : bySourceCode(occupations.filter(node => node.level === 2 && descendsFrom(node, major.slug, bySlug))), [bySlug, major, occupations])
  const minor = minorSlug === '' ? undefined : minors.find(node => node.slug === minorSlug)
  const leaves = useMemo(() => minor === undefined
    ? []
    : bySourceCode(occupations.filter(node => node.level === 4 && descendsFrom(node, minor.slug, bySlug))), [bySlug, minor, occupations])
  const selected = value === '' ? undefined : bySlug.get(value)
  const selectedPath = selected === undefined ? [] : displayPath([...ancestorsFor(selected, bySlug), selected])
  const selectedLabel = selectedPath.length === 0 ? allLabel : selectedPath.map(node => node.name).join(' › ')
  const column = minor === undefined ? (major === undefined ? 0 : 1) : 2
  const needle = search.trim().toLocaleLowerCase()
  const matches = useMemo<readonly Entry[]>(() => {
    if (needle === '') return []
    return occupations.flatMap((node): readonly Entry[] => {
      if (node.level !== 1 && node.level !== 2 && node.level !== 4) return []
      const path = displayPath([...ancestorsFor(node, bySlug), node])
      return path.map(item => item.name).join(' ').toLocaleLowerCase().includes(needle)
        ? [{ node, level: COMMIT, trail: path.slice(0, -1).map(item => item.name) }]
        : []
    })
  }, [bySlug, needle, occupations])
  const entries: readonly Entry[] = needle !== ''
    ? matches
    : column === 0
      ? majors.map((node): Entry => ({ node, level: 0, trail: [] }))
      : column === 1
        ? minors.map((node): Entry => ({ node, level: 1, trail: [] }))
        : leaves.map((node): Entry => ({ node, level: COMMIT, trail: [] }))
  const activeIndex = Math.min(active, Math.max(entries.length - 1, 0))
  const activeEntry = entries[activeIndex]
  const scope = needle === '' ? LEVELS[column] : SEARCH
  const rowId = (name: string, index: number): string => `${id}-row-${name}-${index}`
  const position = useAnchoredPosition({ open, anchorRef: rootRef, panelRef: menuRef, gap: GAP, margin: MARGIN })

  /** Close the menu, handing the keyboard back to the field on a keyboard or selection dismissal. */
  function close(restoreFocus: boolean): void {
    setOpen(false)
    setSearch('')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }
  function select(slug: string): void {
    onChange(slug)
    close(true)
  }
  /** Open at the group the committed value belongs to, so reopening keeps that occupation reachable. */
  function show(): void {
    setMajorSlug(selectedPath.find(node => node.level === 1)?.slug ?? '')
    setMinorSlug(selectedPath.find(node => node.level === 2)?.slug ?? '')
    setSearch('')
    setActive(0)
    setOpen(true)
  }
  function drill(node: SkillsMpTaxonomyOccupation, level: number): void {
    if (level === 0) {
      setMajorSlug(node.slug)
      setMinorSlug('')
    } else {
      setMinorSlug(node.slug)
    }
    setActive(0)
  }
  /** Leave one level: the occupation group first, then the major group. */
  function collapse(): void {
    collapseTo(minor === undefined ? 0 : 1)
  }
  /** Leave the named level: its own drilled group, and everything below it. */
  function collapseTo(level: number): void {
    if (level === 0) setMajorSlug('')
    setMinorSlug('')
    setActive(0)
  }
  function activate(entry: Entry): void {
    if (entry.level === COMMIT) select(entry.node.slug)
    else drill(entry.node, entry.level)
  }

  useEffect(() => { if (open) searchRef.current?.focus() }, [open])
  useEffect(() => {
    if (!open) return
    const row = document.getElementById(rowId(scope, activeIndex))
    if (row !== null && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  })
  useDismissOnOutsidePointer(rootRef, open, () => { close(false) }, menuRef)
  // The menu owns Escape at document capture so the catalog dialog behind it stays open.
  useMenuEscape(open, () => { close(true) })

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    // Tab is consumed here so the catalog dialog behind the menu keeps it; Escape is owned by useMenuEscape.
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) close(true)
      else if (activeEntry !== undefined) activate(activeEntry)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (entries.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(index => (index + step + entries.length) % entries.length)
      return
    }
    // Left and right navigate only while browsing: with a query typed they stay the caret's own.
    if (event.key === 'ArrowRight' && needle === '' && activeEntry !== undefined && activeEntry.level !== COMMIT) {
      event.preventDefault()
      event.stopPropagation()
      drill(activeEntry.node, activeEntry.level)
      return
    }
    if (event.key === 'ArrowLeft' && needle === '' && column > 0) {
      event.preventDefault()
      event.stopPropagation()
      collapse()
      return
    }
    if (event.key === 'Enter' && activeEntry !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      activate(activeEntry)
    }
  }

  const renderRow = (entry: Entry, name: string, index: number, current: boolean): ReactNode => {
    const { node } = entry
    const path = entry.trail.join(' › ')
    const label = node.code === undefined ? node.name : `${node.name}, ${node.code}`
    return <button
      key={node.slug}
      id={rowId(name, index)}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={node.slug === value}
      aria-label={path === '' ? label : `${label}, ${path}`}
      data-active={current && index === activeIndex || undefined}
      className={css.occupationRow}
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => { activate(entry) }}
    >
      {node.code !== undefined ? <code className={css.occupationRowCode}>{node.code}</code> : null}
      <span className={css.occupationRowName} title={node.name}>{node.name}</span>
      {node.skillCount !== undefined ? <span className={css.occupationRowCount}>{node.skillCount.toLocaleString()}</span> : null}
      {entry.level === COMMIT ? null : <span aria-hidden="true" className={css.occupationRowChevron}>›</span>}
      {path === '' ? null : <small className={css.occupationRowTrail}>{path}</small>}
    </button>
  }
  const renderRows = (name: string, listLabel: string, level: number, rows: readonly SkillsMpTaxonomyOccupation[]): ReactNode => {
    const current = name === scope
    return <div
      id={`${id}-list-${name}`}
      className={`${css.occupationColumnRows} scrollable`}
      role="listbox"
      aria-label={listLabel}
      aria-activedescendant={current && entries.length > 0 ? rowId(name, activeIndex) : undefined}
    >
      {rows.map((node, index) => renderRow({ node, level, trail: [] }, name, index, current))}
      {rows.length === 0 ? <p className={css.filterEmpty} role="status">{noResultsLabel}</p> : null}
    </div>
  }
  /** Header of a drilled level: collapse that group, name it, or commit the whole group. */
  const groupHeader = (group: SkillsMpTaxonomyOccupation, level: number): ReactNode => (
    <div className={css.occupationColumnHeader}>
      <button
        type="button"
        className={css.occupationHeaderButton}
        aria-label={collapseGroupLabel(group.name)}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { collapseTo(level) }}
      ><span aria-hidden="true">‹</span></button>
      <span className={css.occupationColumnTitle} title={group.name}>{group.name}</span>
      {group.code !== undefined ? <code className={css.occupationRowCode}>{group.code}</code> : null}
      <button
        type="button"
        className={css.occupationHeaderButton}
        aria-label={selectGroupLabel(group.name)}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { select(group.slug) }}
      ><IconCheckOutlineRegular /></button>
    </div>
  )

  return <div className={css.occupationSelect} ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className={css.occupationTrigger}
      aria-label={`${label}: ${selectedLabel}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? `${id}-list-${scope}` : undefined}
      onClick={() => { if (open) close(true); else show() }}
    >
      <span>{selectedLabel}</span><span aria-hidden="true">⌄</span>
    </button>
    {open ? createPortal(
      <MenuSurface
        ref={menuRef}
        className={css.occupationMenu}
        style={position ?? MEASURE_STYLE}
        role="group"
        aria-label={pickerTitle}
        aria-describedby={`${id}-description`}
      >
        <p id={`${id}-description`} className={css.occupationMenuDescription}>{pickerDescription}</p>
        <div className={css.occupationMenuToolbar}>
          <input
            ref={searchRef}
            type="search"
            role="combobox"
            aria-label={searchLabel}
            aria-autocomplete="list"
            aria-controls={`${id}-list-${scope}`}
            aria-activedescendant={entries.length > 0 ? rowId(scope, activeIndex) : undefined}
            placeholder={searchLabel}
            value={search}
            onChange={(event) => { setSearch(event.currentTarget.value); setActive(0) }}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className={css.occupationMenuButton}
            disabled={value === ''}
            onMouseDown={(event) => { event.preventDefault() }}
            onClick={() => { select('') }}
          >{clearSelectionLabel}</button>
        </div>
        {needle === ''
          ? <div className={css.occupationColumns}>
            <div className={css.occupationColumn}>
              <div className={css.occupationColumnHeader}>
                {column === 0 && activeEntry !== undefined && activeEntry.level !== COMMIT
                  ? <button
                    type="button"
                    className={css.occupationHeaderButton}
                    aria-label={expandGroupLabel(activeEntry.node.name)}
                    onMouseDown={(event) => { event.preventDefault() }}
                    onClick={() => { activate(activeEntry) }}
                  ><span aria-hidden="true">›</span></button>
                  : null}
                <span className={css.occupationColumnTitle}>{majorGroupsLabel}</span>
              </div>
              {renderRows(LEVELS[0], majorGroupsLabel, 0, majors)}
            </div>
            <div className={css.occupationColumn} hidden={major === undefined}>
              {major === undefined ? null : groupHeader(major, 0)}
              {renderRows(LEVELS[1], major?.name ?? majorGroupsLabel, 1, minors)}
            </div>
            <div className={css.occupationColumn} hidden={minor === undefined}>
              {minor === undefined ? null : groupHeader(minor, 1)}
              {renderRows(LEVELS[2], minor?.name ?? majorGroupsLabel, COMMIT, leaves)}
            </div>
          </div>
          : <div
            id={`${id}-list-search`}
            className={`${css.occupationSearchResults} scrollable`}
            role="listbox"
            aria-label={searchLabel}
            aria-activedescendant={entries.length > 0 ? rowId(SEARCH, activeIndex) : undefined}
          >
            {matches.map((match, index) => renderRow(match, SEARCH, index, true))}
            {matches.length === 0 ? <p className={css.filterEmpty} role="status">{noResultsLabel}</p> : null}
          </div>}
      </MenuSurface>,
      document.body,
    ) : null}
  </div>
}
