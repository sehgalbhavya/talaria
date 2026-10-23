// MCP endpoint so Hermes (or any MCP client) can read and drive the board from chat:
//   hermes mcp add talaria --url http://127.0.0.1:5178/mcp
import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Job, JobStatus } from '../shared/types.ts';
import { getJob, listJobs, listReports } from './lib/store.ts';
import { answerQuestions, markApplied, moveJob, prepareApplication } from './agents/pipeline.ts';
import { getScoutState, runScout } from './agents/scout.ts';
import { followUpOnDiscoveries } from './agents/autopilot.ts';
import { funnel } from './agents/report.ts';

const STATUSES = ['discovered', 'preparing', 'needs_input', 'applied', 'interviewing', 'offer', 'archived'] as const;
const score = (j: Job) => j.analysis?.score ?? j.quick?.score;
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

function line(j: Job) {
  const pending = j.questions.filter(q => q.required && !q.answer).length;
  return `- [${j.id}] ${j.title} @ ${j.company} · ${j.location} · fit ${score(j) ?? '?'} · ${j.status}${pending ? ` · ${pending} question(s) waiting` : ''}${j.appliedAt ? ` · applied ${j.appliedAt.slice(0, 10)}` : ''}`;
}

function build() {
  const server = new McpServer({ name: 'talaria', version: '1.0.0' });

  server.registerTool(
    'pipeline_overview',
    { title: 'Pipeline overview', description: 'Counts per board column, plus the jobs that are waiting on the user.' },
    async () => {
      const jobs = listJobs();
      const counts = STATUSES.map(s => `${s}: ${jobs.filter(j => j.status === s).length}`).join(', ');
      const waiting = jobs.filter(j => j.status === 'needs_input');
      const f = funnel(jobs);
      return text(`Board: ${counts}\nFunnel: applied ${f.applied}, heard back ${f.responded}, interviews ${f.interviews}, offers ${f.offers}\n\nWaiting on you:\n${waiting.map(line).join('\n') || '(nothing)'}`);
    },
  );

  server.registerTool(
    'list_jobs',
    {
      title: 'List jobs',
      description: 'List jobs on the board, optionally filtered by status. Sorted by fit score.',
      inputSchema: { status: z.enum(STATUSES).optional(), limit: z.number().int().min(1).max(100).optional() },
    },
    async ({ status, limit }) => {
      const jobs = listJobs()
        .filter(j => (status ? j.status === status : j.status !== 'archived'))
        .sort((a, b) => (score(b) ?? 0) - (score(a) ?? 0))
        .slice(0, limit ?? 30);
      return text(jobs.map(line).join('\n') || 'No jobs.');
    },
  );

  server.registerTool(
    'get_job',
    { title: 'Get job details', description: 'Full details for one job: posting, fit analysis, tailored application and open questions.', inputSchema: { id: z.string() } },
    async ({ id }) => {
      const j = getJob(id);
      if (!j) return text('No job with that id.');
      const a = j.analysis;
      const parts = [
        line(j),
        `URL: ${j.applyUrl || j.url}`,
        a ? `\nFit ${a.score}/100 — ${a.verdict}. ${a.summary}\nWhy you'll get it:\n${a.whyYes.map(x => `  + ${x.point}`).join('\n')}\nWhy you might not:\n${a.whyNo.map(x => `  - ${x.point} (${x.severity})`).join('\n')}\nHow to improve:\n${a.improve.map(x => `  > ${x.action}`).join('\n')}` : '\n(no fit analysis yet)',
        j.questions.length ? `\nQuestions:\n${j.questions.map(q => `  [${q.id}] ${q.question} → ${q.answer ?? '(unanswered)'}`).join('\n')}` : '',
        j.packet ? `\nCover letter:\n${j.packet.coverLetter}` : '',
        `\nPosting:\n${j.descriptionText.slice(0, 3000)}`,
      ];
      return text(parts.join('\n'));
    },
  );

  server.registerTool(
    'find_new_jobs',
    { title: 'Find new jobs', description: 'Run the job scout now (job boards + web search). Takes 1–3 minutes.' },
    async () => {
      if (getScoutState().running) return text('A search is already running.');
      const { added } = await runScout();
      followUpOnDiscoveries().catch(() => {});
      return text(added.length ? `Added ${added.length} new matches:\n${added.map(line).join('\n')}` : 'No new matches this time.');
    },
  );

  server.registerTool(
    'prepare_application',
    { title: 'Prepare application', description: 'Have Hermes tailor the resume, write a cover letter and draft answers for a job. Runs in the background.', inputSchema: { id: z.string() } },
    async ({ id }) => {
      if (!getJob(id)) return text('No job with that id.');
      prepareApplication(id).catch(() => {});
      return text('Started. The job will move to "Needs you" when the draft is ready.');
    },
  );

  server.registerTool(
    'answer_question',
    { title: 'Answer a question', description: "Answer one of Hermes's open questions on an application. The answer is remembered for future applications.", inputSchema: { jobId: z.string(), questionId: z.string(), answer: z.string() } },
    async ({ jobId, questionId, answer }) => {
      await answerQuestions(jobId, [{ id: questionId, answer }]);
      return text('Saved. Hermes is updating the application with your answer.');
    },
  );

  server.registerTool(
    'update_status',
    {
      title: 'Update job status',
      description: 'Move a job: mark applied, interviewing, offer, rejected (archived) or dismissed.',
      inputSchema: { id: z.string(), status: z.enum(['discovered', 'applied', 'interviewing', 'offer', 'rejected', 'dismissed']) },
    },
    async ({ id, status }) => {
      if (!getJob(id)) return text('No job with that id.');
      if (status === 'applied') markApplied(id, 'manual');
      else if (status === 'rejected') moveJob(id, 'archived', { reason: 'rejected' });
      else if (status === 'dismissed') moveJob(id, 'archived', { reason: 'dismissed' });
      else moveJob(id, status as JobStatus);
      return text(`Updated: ${line(getJob(id)!)}`);
    },
  );

  server.registerTool(
    'application_summary',
    { title: 'Application summary', description: 'Everything applied to in the last N days, plus the latest written summary.', inputSchema: { days: z.number().int().min(1).max(365).optional() } },
    async ({ days }) => {
      const d = days ?? 7;
      const since = Date.now() - d * 86400000;
      const applied = listJobs().filter(j => j.appliedAt && Date.parse(j.appliedAt) >= since);
      const latest = listReports()[0];
      return text(`Applied in the last ${d} days (${applied.length}):\n${applied.map(line).join('\n') || '(none)'}${latest ? `\n\nLatest summary (${latest.generatedAt.slice(0, 10)}):\n${latest.markdown}` : ''}`);
    },
  );

  return server;
}

export function mountMcp(app: Express) {
  app.post('/mcp', async (req: Request, res: Response) => {
    const server = build();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null });
    }
  });
  const notAllowed = (_req: Request, res: Response) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
