import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { AspectRatio, AutoIdea, AutoStatus, Job, NewAutoIdeaInput } from '@shared/types'
import { getDb } from './db'
import { startExport } from './exporter'
import { generateCharacterSheet, generateMissingImages, generateMissingVideos } from './generation'
import { generateNarration } from './narration'
import { charactersOf, createProject, getJob, getProject } from './repo'
import { getSettings, setSettings } from './settings'
import { generateScript, generateVisuals } from './story'

/**
 * Daily automatic production.
 *
 * The user queues story ideas and picks a time of day. Once a day, when the app
 * is running and that time has passed, the next ideas (up to the per-day count)
 * are produced end to end with the normal pipeline: script, visuals, character
 * sheets, images, videos, narration, and (when enabled) an MP4 export. Every
 * step goes through the ordinary job queues, so progress, failures, and costs
 * behave exactly like a production the user started by hand. The batch needs
 * the app to be open; a missed day is not made up, the next run simply happens
 * at the next scheduled time.
 */

interface IdeaRow {
  id: string
  synopsis: string
  duration_sec: number
  language: string
  aspect_ratio: string
  style_id: string
  status: AutoIdea['status']
  project_id: string | null
  message: string | null
  created_at: number
  used_at: number | null
}

function toIdea(r: IdeaRow): AutoIdea {
  return {
    id: r.id,
    synopsis: r.synopsis,
    durationSec: r.duration_sec,
    language: r.language,
    aspectRatio: r.aspect_ratio as AspectRatio,
    styleId: r.style_id,
    status: r.status,
    projectId: r.project_id,
    message: r.message,
    createdAt: r.created_at,
    usedAt: r.used_at
  }
}

export function listAutoIdeas(): AutoIdea[] {
  const rows = getDb()
    .prepare('SELECT * FROM auto_ideas ORDER BY created_at ASC')
    .all() as unknown as IdeaRow[]
  return rows.map(toIdea)
}

export function addAutoIdea(input: NewAutoIdeaInput): AutoIdea {
  const synopsis = input.synopsis.trim()
  if (!synopsis) throw new Error('Ide cerita masih kosong')
  const s = getSettings()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO auto_ideas (id, synopsis, duration_sec, language, aspect_ratio, style_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      id,
      synopsis,
      input.durationSec ?? 60,
      input.language ?? s.defaultLanguage,
      input.aspectRatio ?? '16:9',
      input.styleId ?? 'stickman',
      Date.now()
    )
  const row = getDb().prepare('SELECT * FROM auto_ideas WHERE id = ?').get(id) as unknown as IdeaRow
  return toIdea(row)
}

export function removeAutoIdea(id: string): void {
  getDb().prepare("DELETE FROM auto_ideas WHERE id = ? AND status != 'processing'").run(id)
}

function setIdea(id: string, patch: Partial<{ status: AutoIdea['status']; projectId: string | null; message: string | null; usedAt: number | null }>): void {
  const cols: string[] = []
  const vals: unknown[] = []
  if (patch.status !== undefined) { cols.push('status = ?'); vals.push(patch.status) }
  if (patch.projectId !== undefined) { cols.push('project_id = ?'); vals.push(patch.projectId) }
  if (patch.message !== undefined) { cols.push('message = ?'); vals.push(patch.message) }
  if (patch.usedAt !== undefined) { cols.push('used_at = ?'); vals.push(patch.usedAt) }
  if (!cols.length) return
  vals.push(id)
  getDb().prepare(`UPDATE auto_ideas SET ${cols.join(', ')} WHERE id = ?`).run(...vals)
}

const JOB_TIMEOUT_MS = 30 * 60 * 1000
const POLL_MS = 1500

/** Waits until a job leaves the queue: resolves on done, throws on failed, canceled, or timeout. */
async function waitForJob(job: Job): Promise<void> {
  const deadline = Date.now() + JOB_TIMEOUT_MS
  for (;;) {
    const j = getJob(job.id)
    if (!j) throw new Error('Pekerjaan tidak ditemukan')
    if (j.status === 'done') return
    if (j.status === 'failed' || j.status === 'canceled') {
      throw new Error(j.error ?? `Pekerjaan ${j.kind} ${j.status === 'failed' ? 'gagal' : 'dibatalkan'}`)
    }
    if (Date.now() > deadline) throw new Error(`Pekerjaan ${j.kind} melewati batas waktu 30 menit`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}

async function waitForJobs(jobs: Job[]): Promise<void> {
  for (const j of jobs) await waitForJob(j)
}

function exportFolder(): string {
  return getSettings().exportFolder ?? join(app.getPath('videos'), 'UtoStory Studio')
}

function safeFileName(title: string): string {
  const clean = title.replace(/[<>:"/\\|?*]+/g, '').trim()
  return clean || 'video-otomatis'
}

/** Runs one queued idea through the whole pipeline. Throws with a readable message on failure. */
async function produceOne(idea: AutoIdea): Promise<void> {
  const project = createProject({
    synopsis: idea.synopsis,
    durationSec: idea.durationSec,
    language: idea.language,
    aspectRatio: idea.aspectRatio,
    styleId: idea.styleId
  })
  setIdea(idea.id, { projectId: project.id })

  await generateScript(project.id)
  await generateVisuals(project.id, 'all')

  for (const ch of charactersOf(project.id)) {
    if (!ch.sheetAssetId) await waitForJob(generateCharacterSheet(ch.id))
  }
  await waitForJobs(generateMissingImages(project.id))
  await waitForJobs(generateMissingVideos(project.id))
  await waitForJob(generateNarration(project.id, 'all'))

  if (getSettings().autoExport) {
    const fresh = getProject(project.id)
    await waitForJob(
      startExport(project.id, {
        fileName: safeFileName(fresh.title),
        resolution: 1080,
        fps: 30,
        burnCaptions: true,
        writeSrt: true,
        normalizeAudio: true,
        duckMusic: true,
        folder: exportFolder()
      })
    )
  }
}

let running = false
let currentSynopsis: string | null = null

export function getAutoStatus(): AutoStatus {
  const s = getSettings()
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM auto_ideas WHERE status = 'pending'")
    .get() as { n: number }
  return { running, currentSynopsis, lastRunDate: s.autoLastRunDate, pendingCount: row.n }
}

/**
 * Produces up to the per-day count of pending ideas, one after another.
 * A scheduled run marks the day as used before it starts, so an app restart
 * later that day never produces a second batch. A manual run leaves the
 * day's schedule untouched.
 */
export async function runAutoBatch(source: 'schedule' | 'manual'): Promise<void> {
  if (running) return
  const s = getSettings()
  const perDay = Math.min(5, Math.max(1, Math.round(s.autoPerDay) || 2))
  const ideas = listAutoIdeas().filter((i) => i.status === 'pending').slice(0, perDay)
  if (!ideas.length) return
  if (source === 'schedule') {
    setSettings({ autoLastRunDate: localDate(new Date()) })
  }
  running = true
  try {
    for (const idea of ideas) {
      currentSynopsis = idea.synopsis
      setIdea(idea.id, { status: 'processing', usedAt: Date.now(), message: null })
      try {
        await produceOne(idea)
        setIdea(idea.id, { status: 'done', message: null })
      } catch (err) {
        setIdea(idea.id, { status: 'failed', message: err instanceof Error ? err.message : String(err) })
      }
    }
  } finally {
    running = false
    currentSynopsis = null
  }
}

function localDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

function parseTime(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return 7 * 60
  return Math.min(23, Math.max(0, Number(m[1]))) * 60 + Math.min(59, Math.max(0, Number(m[2])))
}

let timer: NodeJS.Timeout | null = null

/** Starts the daily checker. Call once at app start, next to resumeJobs(). */
export function startAutoProducer(): void {
  if (timer) return
  const tick = (): void => {
    const s = getSettings()
    if (!s.autoEnabled || running) return
    const now = new Date()
    if (s.autoLastRunDate === localDate(now)) return
    if (minutesOfDay(now) < parseTime(s.autoTime)) return
    void runAutoBatch('schedule')
  }
  timer = setInterval(tick, 30_000)
  setTimeout(tick, 15_000)
}
