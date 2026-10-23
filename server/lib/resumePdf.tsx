import React from 'react';
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { TailoredResume } from '../../shared/types.ts';

// Built-in Helvetica keeps the PDF ATS-friendly and dependency-free, but it only covers
// WinAnsi. Map the common outliers and drop anything else that can't render.
function safe(s?: string) {
  if (!s) return '';
  return s
    .replace(/[→⇒]/g, '->')
    .replace(/[←]/g, '<-')
    .replace(/₹/g, 'Rs.')
    .replace(/[−]/g, '-')
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/[   ]/g, ' ')
    .replace(/[^\x00-\xff–—‘’“”•…€™ŒœŠšŸŽžƒˆ˜†‡‰‹›]/g, '');
}

const INK = '#16161d';
const MUTED = '#5a5a66';
const RULE = '#d9d9e0';
const ACCENT = '#3b3bb3';

// Styles scale down together so a long resume can be shrunk onto one page.
function makeStyles(k = 1) {
  const f = (n: number) => Math.round(n * k * 100) / 100;
  return StyleSheet.create({
    page: { paddingTop: f(32), paddingBottom: f(30), paddingHorizontal: f(40), fontFamily: 'Helvetica', fontSize: f(9.6), color: INK, lineHeight: 1.36 },
    name: { fontFamily: 'Helvetica-Bold', fontSize: f(21) },
    headline: { fontSize: f(10.5), color: MUTED, marginTop: 2 },
    contact: { flexDirection: 'row', flexWrap: 'wrap', marginTop: f(5), fontSize: f(8.8), color: MUTED },
    contactItem: { marginRight: 10 },
    link: { color: ACCENT, textDecoration: 'none' },
    section: { marginTop: f(10) },
    // No letter-spacing: tracked capitals extract as "S U M M A R Y" in applicant-tracking systems.
    sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: f(9.4), color: ACCENT, textTransform: 'uppercase', paddingBottom: 2.5, borderBottomWidth: 0.7, borderBottomColor: RULE, marginBottom: f(4.5) },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    itemTitle: { fontFamily: 'Helvetica-Bold', fontSize: f(10) },
    itemSub: { color: MUTED, fontSize: f(9) },
    dates: { color: MUTED, fontSize: f(8.8) },
    bullet: { flexDirection: 'row', marginTop: f(1.4), paddingRight: 6 },
    dot: { width: 9, color: MUTED },
    bulletText: { flex: 1 },
    item: { marginBottom: f(5.5) },
    skillRow: { flexDirection: 'row', marginBottom: 1.5 },
    skillGroup: { fontFamily: 'Helvetica-Bold', width: f(96) },
    letterBody: { fontSize: f(10.5), lineHeight: 1.55, marginTop: 18 },
    para: { marginBottom: 9 },
  });
}

let s = makeStyles();

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items.map((b, i) => (
        <View key={i} style={s.bullet} wrap={false}>
          <Text style={s.dot}>•</Text>
          <Text style={s.bulletText}>{safe(b)}</Text>
        </View>
      ))}
    </>
  );
}

function Header({ r }: { r: TailoredResume }) {
  const c = r.contact || { links: [] };
  return (
    <View>
      <Text style={s.name}>{safe(r.name)}</Text>
      {r.headline ? <Text style={s.headline}>{safe(r.headline)}</Text> : null}
      <View style={s.contact}>
        {c.email ? <Text style={s.contactItem}>{safe(c.email)}</Text> : null}
        {c.phone ? <Text style={s.contactItem}>{safe(c.phone)}</Text> : null}
        {c.location ? <Text style={s.contactItem}>{safe(c.location)}</Text> : null}
        {(c.links || []).map((l, i) => (
          <Link key={i} src={l.url} style={[s.contactItem, s.link]}>
            {safe(l.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}
          </Link>
        ))}
      </View>
    </View>
  );
}

function ResumeDoc({ r, size }: { r: TailoredResume; size: 'A4' | 'LETTER' }) {
  const dates = (a?: string, b?: string) => safe([a, b].filter(Boolean).join(' – '));
  return (
    <Document title={`${r.name} — Resume`} author={r.name} creator="Talaria">
      <Page size={size} style={s.page}>
        <Header r={r} />
        {r.summary ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Summary</Text>
            <Text>{safe(r.summary)}</Text>
          </View>
        ) : null}
        {r.skills?.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Skills</Text>
            {r.skills.map((g, i) => (
              <View key={i} style={s.skillRow}>
                <Text style={s.skillGroup}>{safe(g.group)}</Text>
                <Text style={{ flex: 1 }}>{safe(g.items.join(', '))}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {r.experience?.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Experience</Text>
            {r.experience.map((e, i) => (
              <View key={i} style={s.item}>
                <View style={s.row} wrap={false}>
                  <Text style={s.itemTitle}>
                    {safe(e.title)}
                    <Text style={{ fontFamily: 'Helvetica', color: MUTED }}> · {safe(e.company)}</Text>
                  </Text>
                  <Text style={s.dates}>{dates(e.start, e.end)}</Text>
                </View>
                {e.location ? <Text style={s.itemSub}>{safe(e.location)}</Text> : null}
                <Bullets items={e.bullets} />
              </View>
            ))}
          </View>
        ) : null}
        {r.projects?.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Projects</Text>
            {r.projects.map((p, i) => (
              <View key={i} style={s.item}>
                <View style={s.row} wrap={false}>
                  <Text style={s.itemTitle}>
                    {safe(p.name)}
                    {p.tech?.length ? <Text style={{ fontFamily: 'Helvetica', color: MUTED }}> · {safe(p.tech.join(', '))}</Text> : null}
                  </Text>
                  {p.link ? (
                    <Link src={p.link} style={[s.dates, s.link]}>
                      {safe(p.link.replace(/^https?:\/\/(www\.)?/, ''))}
                    </Link>
                  ) : null}
                </View>
                <Bullets items={p.bullets} />
              </View>
            ))}
          </View>
        ) : null}
        {r.education?.length ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Education</Text>
            {r.education.map((e, i) => (
              <View key={i} style={s.item} wrap={false}>
                <View style={s.row}>
                  <Text style={s.itemTitle}>{safe(e.school)}</Text>
                  <Text style={s.dates}>{dates(e.start, e.end)}</Text>
                </View>
                <Text style={s.itemSub}>{safe([e.degree, e.field].filter(Boolean).join(', '))}</Text>
                {e.details ? <Text>{safe(e.details)}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        {(r.extras || []).map((x, i) => (
          <View key={i} style={s.section}>
            <Text style={s.sectionTitle}>{safe(x.label)}</Text>
            <Bullets items={x.items} />
          </View>
        ))}
      </Page>
    </Document>
  );
}

function LetterDoc({ r, body, company, size }: { r: TailoredResume; body: string; company: string; size: 'A4' | 'LETTER' }) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <Document title={`${r.name} — Cover letter — ${company}`} author={r.name} creator="Talaria">
      <Page size={size} style={[s.page, { paddingHorizontal: 60, paddingTop: 54 }]}>
        <Header r={r} />
        <View style={s.letterBody}>
          <Text style={[s.para, { color: MUTED }]}>{date}</Text>
          {body
            .split(/\n{2,}/)
            .map(p => p.trim())
            .filter(Boolean)
            .map((p, i) => (
              <Text key={i} style={s.para}>
                {safe(p)}
              </Text>
            ))}
        </View>
      </Page>
    </Document>
  );
}

export function pageSizeFor(location?: string): 'A4' | 'LETTER' {
  return /united states|usa|\bus\b|canada|, [A-Z]{2}\b/i.test(location || '') ? 'LETTER' : 'A4';
}

const pageCount = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

export async function resumePdf(r: TailoredResume) {
  const size = pageSizeFor(r.contact?.location);
  let buf: Buffer = Buffer.alloc(0);
  // Try progressively tighter type until it fits on one page (or we hit a readable minimum).
  for (const k of [1, 0.95, 0.9, 0.86]) {
    s = makeStyles(k);
    buf = await renderToBuffer(<ResumeDoc r={r} size={size} />);
    if (pageCount(buf) <= 2) break;
  }
  s = makeStyles();
  return buf;
}

export async function coverLetterPdf(r: TailoredResume, body: string, company: string) {
  s = makeStyles();
  return renderToBuffer(<LetterDoc r={r} body={body} company={company} size={pageSizeFor(r.contact?.location)} />);
}
