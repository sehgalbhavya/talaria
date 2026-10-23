import type { TailoredResume } from '@shared/types';

/** On-screen twin of the PDF the server renders — always ink on paper, even in dark mode. */
export function ResumePreview({ resume: r }: { resume: TailoredResume }) {
  const dates = (a?: string, b?: string) => [a, b].filter(Boolean).join(' – ');
  const c = r.contact || { links: [] };
  return (
    <div className="rounded-2xl bg-[#e9e7e1] p-3 sm:p-5 dark:bg-[#0a0a0c]">
      <article className="mx-auto max-w-[680px] rounded-[4px] bg-white px-10 py-9 text-[12.5px] leading-[1.45] text-[#16161d] shadow-[0_2px_8px_rgb(0_0_0/0.08),0_20px_40px_-20px_rgb(0_0_0/0.25)]" style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>
        <h1 className="text-[25px] leading-tight font-bold tracking-[-0.01em]">{r.name}</h1>
        {r.headline && <div className="mt-0.5 text-[13.5px] text-[#5a5a66]">{r.headline}</div>}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-[#5a5a66]">
          {[c.email, c.phone, c.location].filter(Boolean).map(x => (
            <span key={x}>{x}</span>
          ))}
          {(c.links || []).map(l => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-[#3b3bb3]">
              {l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
            </a>
          ))}
        </div>

        {r.summary && (
          <Section title="Summary">
            <p>{r.summary}</p>
          </Section>
        )}

        {r.skills?.length > 0 && (
          <Section title="Skills">
            <div className="space-y-0.5">
              {r.skills.map(g => (
                <div key={g.group} className="flex gap-2">
                  <span className="w-[120px] shrink-0 font-bold">{g.group}</span>
                  <span>{g.items.join(', ')}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {r.experience?.length > 0 && (
          <Section title="Experience">
            {r.experience.map((e, i) => (
              <div key={i} className="mb-2.5 last:mb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-bold">{e.title}</span>
                    <span className="text-[#5a5a66]"> · {e.company}</span>
                  </div>
                  <span className="shrink-0 text-[11.5px] text-[#5a5a66]">{dates(e.start, e.end)}</span>
                </div>
                {e.location && <div className="text-[11.5px] text-[#5a5a66]">{e.location}</div>}
                <Bullets items={e.bullets} />
              </div>
            ))}
          </Section>
        )}

        {r.projects?.length > 0 && (
          <Section title="Projects">
            {r.projects.map((p, i) => (
              <div key={i} className="mb-2.5 last:mb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-bold">{p.name}</span>
                    {p.tech?.length ? <span className="text-[#5a5a66]"> · {p.tech.join(', ')}</span> : null}
                  </div>
                  {p.link && (
                    <a href={p.link} target="_blank" rel="noreferrer" className="shrink-0 text-[11.5px] text-[#3b3bb3]">
                      {p.link.replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  )}
                </div>
                <Bullets items={p.bullets} />
              </div>
            ))}
          </Section>
        )}

        {r.education?.length > 0 && (
          <Section title="Education">
            {r.education.map((e, i) => (
              <div key={i} className="mb-2 last:mb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold">{e.school}</span>
                  <span className="shrink-0 text-[11.5px] text-[#5a5a66]">{dates(e.start, e.end)}</span>
                </div>
                <div className="text-[#5a5a66]">{[e.degree, e.field].filter(Boolean).join(', ')}</div>
                {e.details && <div>{e.details}</div>}
              </div>
            ))}
          </Section>
        )}

        {(r.extras || []).map(x => (
          <Section key={x.label} title={x.label}>
            <Bullets items={x.items} />
          </Section>
        ))}
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="mb-1.5 border-b border-[#d9d9e0] pb-1 text-[10.5px] font-bold tracking-[0.14em] text-[#3b3bb3] uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 space-y-[3px]">
      {items.map((b, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-[#8a8a96]">•</span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}
