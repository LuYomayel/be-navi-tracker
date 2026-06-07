import { Injectable, Logger } from '@nestjs/common';

interface TrelloCard {
  name: string;
  url: string;
  list: string;
  due: string; // flag de vencimiento ('', '⚠ vencido Nd', '⏰ vence en Nd')
}

interface BoardCfg {
  code: string;
  name: string;
  id: string;
  mineOnly: boolean;
}

/**
 * Lee tickets prioritarios de Trello por REST (read-only). Replica la logica
 * del `fetch_my_tickets.py` del hub cowork. Credenciales por env:
 *   - TRELLO_API_KEY
 *   - TRELLO_TOKEN
 * Si faltan, devuelve `configured:false` y no rompe (el briefing sigue).
 */
@Injectable()
export class TrelloService {
  private readonly logger = new Logger(TrelloService.name);

  private readonly boards: BoardCfg[] = [
    { code: 'STA', name: 'Stampia', id: 'V4td7wG7', mineOnly: false },
    { code: 'EAS', name: 'EaseTrain', id: 'YOLoy3Xk', mineOnly: false },
    { code: 'PLA', name: 'Platform Dev', id: '8eyfXCX9', mineOnly: true },
  ];

  get isConfigured(): boolean {
    return !!(process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN);
  }

  private bucketFor(listName: string): string {
    const n = (listName || '').toLowerCase();
    const tokens = new Set(n.replace(/[[\]/]/g, ' ').split(/\s+/));
    if (['done', 'completed', 'shipped', 'production'].some((k) => n.includes(k)))
      return 'done';
    if (['doing', 'in progress', 'in-progress', 'wip', 'working'].some((k) => n.includes(k)))
      return 'en_curso';
    if (
      ['review', 'testing', 'qa', 'uat', 'staging'].some((k) => n.includes(k)) ||
      tokens.has('pr')
    )
      return 'en_revision';
    if (['to do', 'to-do', 'todo', 'next', 'sprint'].some((k) => n.includes(k)))
      return 'proximas';
    if (['backlog', 'someday', 'icebox', 'ideas'].some((k) => n.includes(k)))
      return 'backlog';
    return 'otras';
  }

  private async api(path: string): Promise<any> {
    const key = process.env.TRELLO_API_KEY;
    const tok = process.env.TRELLO_TOKEN;
    const sep = path.includes('?') ? '&' : '?';
    const url = `https://api.trello.com/1${path}${sep}key=${key}&token=${tok}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Trello respondio ${res.status}`);
    return res.json();
  }

  /**
   * Tickets prioritarios por board (en_curso / en_revision / proximas) + los
   * vencidos / por vencer cruzando boards. Platform Dev se filtra a "mios".
   */
  async getMyTickets(): Promise<{
    configured: boolean;
    boards: { code: string; name: string; buckets: Record<string, TrelloCard[]> }[];
    flagged: (TrelloCard & { code: string })[];
  }> {
    if (!this.isConfigured) return { configured: false, boards: [], flagged: [] };

    const me = await this.api('/members/me?fields=id,username');
    const myId = me.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const boards: any[] = [];
    const flagged: any[] = [];

    for (const b of this.boards) {
      try {
        const lists = await this.api(
          `/boards/${b.id}/lists?fields=name&filter=open`,
        );
        const listName: Record<string, string> = {};
        for (const l of lists) listName[l.id] = l.name;

        const cards = await this.api(
          `/boards/${b.id}/cards?fields=name,due,dueComplete,idList,idMembers,shortUrl&filter=open`,
        );

        const buckets: Record<string, TrelloCard[]> = {
          en_curso: [],
          en_revision: [],
          proximas: [],
          backlog: [],
          otras: [],
          done: [],
        };

        for (const c of cards) {
          if (b.mineOnly && !(c.idMembers || []).includes(myId)) continue;
          const bk = this.bucketFor(listName[c.idList] || '');
          let dueFlag = '';
          if (c.due && !c.dueComplete) {
            const d = new Date(c.due);
            d.setHours(0, 0, 0, 0);
            const delta = Math.round((d.getTime() - today.getTime()) / 86400000);
            if (delta < 0) dueFlag = `⚠ vencido ${-delta}d`;
            else if (delta <= 3) dueFlag = `⏰ vence en ${delta}d`;
          }
          const card: TrelloCard = {
            name: c.name,
            url: c.shortUrl,
            list: listName[c.idList] || '',
            due: dueFlag,
          };
          buckets[bk].push(card);
          if (dueFlag) flagged.push({ code: b.code, ...card });
        }
        boards.push({ code: b.code, name: b.name, buckets });
      } catch (e) {
        this.logger.warn(`Trello board ${b.code}: ${(e as Error).message}`);
      }
    }

    return { configured: true, boards, flagged };
  }

  /** Resumen compacto en texto para el briefing / el tool MCP. */
  async getTicketsSummary(): Promise<string> {
    const r = await this.getMyTickets();
    if (!r.configured)
      return 'Trello no configurado (faltan TRELLO_API_KEY / TRELLO_TOKEN).';
    const lines: string[] = [];
    if (r.flagged.length) {
      lines.push('⏰ Con fecha (vencidos / por vencer):');
      for (const c of r.flagged.slice(0, 8))
        lines.push(`  [${c.code}] ${c.name} · ${c.due}`);
    }
    for (const b of r.boards) {
      const enCurso = b.buckets.en_curso || [];
      const enRev = b.buckets.en_revision || [];
      const prox = b.buckets.proximas || [];
      if (!enCurso.length && !enRev.length && !prox.length) continue;
      lines.push(`${b.name} [${b.code}]:`);
      for (const c of enCurso.slice(0, 10)) lines.push(`  🔵 ${c.name}`);
      for (const c of enRev.slice(0, 5)) lines.push(`  🟡 ${c.name}`);
      for (const c of prox.slice(0, 5)) lines.push(`  ⚪ ${c.name}`);
    }
    return lines.length ? lines.join('\n') : 'Sin tickets prioritarios hoy.';
  }
}
