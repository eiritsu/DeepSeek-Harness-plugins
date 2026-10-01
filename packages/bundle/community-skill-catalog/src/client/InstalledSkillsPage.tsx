/** Global DSH skill directory management page in the official Plugins panel. */
import { useEffect, useState } from 'react'
import { Button, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InstalledSkill } from '@deepseek-ai/dsh-community-skill-catalog/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillCatalogPage.module.css'

type SkillManagerRemote = {
  listInstalledSkills(): Promise<RemoteResult<readonly InstalledSkill[]>>
  removeInstalledSkill(id: string, confirmed: boolean): Promise<RemoteResult<string>>
}

interface Injected { readonly api: SkillManagerRemote }
type Props = PropsRuntime<'plugins.item'> & PropsLocale<'skillCatalog'> & InjectFace<Injected>

/** Render installed global skills inside the official Plugins page. */
export function InstalledSkillsPage({ view, api, t }: Props) {
  const [skills, setSkills] = useState<readonly InstalledSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState(false)
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<InstalledSkill>()
  const [acknowledged, setAcknowledged] = useState(false)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (view === 'summary') return
    let active = true
    setLoading(true)
    setFailure(false)
    void api.listInstalledSkills().then((result) => {
      if (!result.ok) throw result.error
      if (active) setSkills(result.value)
    }).catch(() => {
      if (active) setFailure(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [api, revision, view])

  if (view === 'summary') return <>{t('managerDescription')}</>

  const cancel = (): void => { if (!removing) { setSelected(undefined); setAcknowledged(false) } }
  const remove = async (): Promise<void> => {
    if (selected === undefined || removing || !acknowledged) return
    setRemoving(true)
    setNotice('')
    try {
      const result = await api.removeInstalledSkill(selected.id, true)
      if (!result.ok) throw result.error
      setSkills(current => current.filter(skill => skill.id !== selected.id))
      setNotice(t('skillRemoved'))
      setSelected(undefined)
      setAcknowledged(false)
    } catch {
      setNotice(t('skillRemoveFailed'))
    } finally { setRemoving(false) }
  }

  return <section className={css.manager} aria-label={t('managerTitle')}>
    <div className={css.managerHeader}>
      <div><h3 className={css.managerTitle}>{t('managerTitle')}</h3><p className={css.description}>{t('managerIntro')}</p></div>
      <Button variant="outline" disabled={loading} onClick={() => { setRevision(value => value + 1) }}>{t('refreshSkills')}</Button>
    </div>
    {failure && <p className={css.error} role="alert">{t('skillLoadFailed')}</p>}
    {notice !== '' && <p className={css.notice} role="status">{notice}</p>}
    {loading ? <p className={css.status} role="status">{t('skillsLoading')}</p>
      : skills.length === 0 ? <p className={css.status}>{t('skillsEmpty')}</p>
        : <ul className={css.managerList}>
          {skills.map(skill => <li className={css.managerRow} key={skill.id}>
            <span className={css.managerName}>{skill.name}</span>
            <Button variant="outline" disabled={removing} onClick={() => { setSelected(skill); setAcknowledged(false) }}>{t('removeSkill')}</Button>
          </li>)}
        </ul>}
    <RiskConfirmation
      open={selected !== undefined}
      title={t('removeSkillTitle')}
      description={selected === undefined ? '' : t('removeSkillDescription', { name: selected.name })}
      acknowledgeLabel={t('acknowledgeSkillRemoval')}
      cancelLabel={t('cancel')}
      closeLabel={t('closeReview')}
      confirmLabel={t('confirmSkillRemoval')}
      acknowledged={acknowledged}
      disabled={removing}
      onAcknowledgedChange={setAcknowledged}
      onCancel={cancel}
      onConfirm={() => { void remove() }}
    />
  </section>
}
