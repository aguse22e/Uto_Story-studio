import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Play, Plus, Trash2 } from 'lucide-react'
import type { AppSettings, AspectRatio, AutoIdea, AutoStatus } from '@shared/types'
import { Badge, Button, Field, IconButton, Segmented, Switch, confirmDialog, inputCls } from '../components/ui'

const STATUS_BADGE: Record<AutoIdea['status'], { tone: 'draft' | 'warn' | 'ok' | 'bad'; label: string }> = {
  pending: { tone: 'draft', label: 'Menunggu' },
  processing: { tone: 'warn', label: 'Sedang diproduksi' },
  done: { tone: 'ok', label: 'Selesai' },
  failed: { tone: 'bad', label: 'Gagal' }
}

/**
 * Daily automatic production: a queue of story ideas that the app turns into
 * finished videos on its own, once a day at the chosen time, while it is open.
 */
export function AutoSection({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const [ideas, setIdeas] = useState<AutoIdea[]>([])
  const [status, setStatus] = useState<AutoStatus | null>(null)
  const [synopsis, setSynopsis] = useState('')
  const [durationSec, setDurationSec] = useState(60)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9')

  const reload = useCallback(async (): Promise<void> => {
    const [list, st] = await Promise.all([window.api.auto.listIdeas(), window.api.auto.status()])
    setIdeas(list)
    setStatus(st)
  }, [])

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(), 5000)
    return () => clearInterval(t)
  }, [reload])

  const patch = async (p: Partial<AppSettings>): Promise<void> => {
    onSettings(await window.api.settings.set(p))
  }

  const add = async (): Promise<void> => {
    const text = synopsis.trim()
    if (!text) return
    await window.api.auto.addIdea({ synopsis: text, durationSec, aspectRatio })
    setSynopsis('')
    await reload()
  }

  const remove = async (idea: AutoIdea): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Hapus ide dari antrean?',
      body: 'Ide ini tidak akan diproduksi otomatis. Proyek yang sudah terlanjur dibuat tidak ikut terhapus.',
      confirm: 'Hapus ide',
      danger: true
    })
    if (!ok) return
    await window.api.auto.removeIdea(idea.id)
    await reload()
  }

  const runNow = async (): Promise<void> => {
    setStatus(await window.api.auto.runNow())
    await reload()
  }

  return (
    <>
      <div className="mt-5 flex items-start gap-3">
        <span className="mt-1 text-ink">
          <CalendarClock className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[22px] font-bold leading-tight">Produksi otomatis harian</h2>
          <p className="text-sm text-ink-2">
            Taruh ide cerita di antrean, lalu aplikasi memproduksinya sendiri jadi video setiap hari selama aplikasi terbuka.
          </p>
        </div>
      </div>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-[18px]">
        <Switch
          on={settings.autoEnabled}
          onChange={(v) => void patch({ autoEnabled: v })}
          label="Nyalakan produksi otomatis"
        />
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Jam mulai" hint="Waktu komputer ini">
            <input
              type="time"
              className={inputCls}
              value={settings.autoTime}
              onChange={(e) => void patch({ autoTime: e.target.value || '07:00' })}
            />
          </Field>
          <Field label="Video per hari" hint="Diambil dari antrean teratas">
            <input
              type="number"
              min={1}
              max={5}
              className={inputCls}
              value={settings.autoPerDay}
              onChange={(e) => void patch({ autoPerDay: Math.min(5, Math.max(1, Number(e.target.value) || 2)) })}
            />
          </Field>
          <div className="pb-1">
            <Switch
              on={settings.autoExport}
              onChange={(v) => void patch({ autoExport: v })}
              label="Ekspor MP4 otomatis"
            />
          </div>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-2">
          Setiap video melewati jalur biasa: naskah, rencana visual, gambar, video, narasi, lalu ekspor. Biaya layanan
          tetap memakai kunci API kamu dan kredit Higgsfield seperti produksi manual, jadi pastikan antrean ide memang
          ingin kamu buat. Kalau aplikasi tertutup saat jamnya tiba, produksi menunggu sampai aplikasi dibuka lagi di
          hari yang sama.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<Play className="size-4" />} onClick={() => void runNow()} disabled={!status || status.running || status.pendingCount === 0}>
            Jalankan sekarang
          </Button>
          <span className="text-[13px] text-ink-2">
            {status?.running
              ? `Sedang memproduksi: ${status.currentSynopsis ?? ''}`
              : status
                ? `${status.pendingCount} ide menunggu${status.lastRunDate ? ` · terakhir jalan otomatis ${status.lastRunDate}` : ''}`
                : 'Memuat status…'}
          </span>
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <span className="text-base font-bold">Antrean ide cerita</span>
          <Field label="Ide atau sinopsis baru" hint="Bahasa, gaya visual, model, dan suara mengikuti pengaturan bawaan aplikasi">
            <textarea
              className={inputCls}
              rows={3}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="Contoh: Bagaimana rasanya hidup di Batavia tahun 1700-an?"
            />
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Target durasi (detik)">
              <input
                type="number"
                min={30}
                max={600}
                step={30}
                className={inputCls}
                value={durationSec}
                onChange={(e) => setDurationSec(Math.min(600, Math.max(30, Number(e.target.value) || 60)))}
              />
            </Field>
            <Field label="Format">
              <Segmented<AspectRatio>
                value={aspectRatio}
                onChange={setAspectRatio}
                options={[
                  { id: '16:9', label: '16:9' },
                  { id: '9:16', label: '9:16' }
                ]}
              />
            </Field>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => void add()} disabled={!synopsis.trim()}>
              Tambah ke antrean
            </Button>
          </div>
          {ideas.length === 0 ? (
            <p className="text-[13px] text-ink-2">Antrean masih kosong. Tambahkan ide pertamamu di atas.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ideas.map((idea) => {
                const badge = STATUS_BADGE[idea.status]
                return (
                  <li key={idea.id} className="flex items-start gap-3 rounded-xl border border-line px-3.5 py-3">
                    <div className="flex flex-1 flex-col gap-1">
                      <span className="text-sm font-medium leading-snug">{idea.synopsis}</span>
                      <span className="text-[12px] text-ink-2">
                        {idea.durationSec} detik · {idea.aspectRatio}
                        {idea.status === 'failed' && idea.message ? ` · ${idea.message}` : ''}
                      </span>
                    </div>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    {idea.status !== 'processing' && (
                      <IconButton label="Hapus ide" size={32} onClick={() => void remove(idea)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
