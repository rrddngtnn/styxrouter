interface Key { id?: string; name?: string; prefix?: string; isActive?: boolean }
interface Combo { id: string; name?: string; strategy?: string; enabled?: boolean; models?: (string | Record<string,unknown>)[] }
const matches = (values: unknown[], query: string) => values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
export const filterKeys = <T extends Key>(rows:T[], query:string):T[] => rows.filter(r=>matches([r.name,r.prefix,r.isActive === false ? 'revoked dicabut' : 'active aktif'],query));
export const filterCombos = <T extends Combo>(rows:T[], query:string):T[] => rows.filter(r=>matches([r.name,r.strategy ?? 'priority',r.enabled ? 'enabled aktif' : 'disabled nonaktif',...(r.models ?? []).map(m=>typeof m === 'string' ? m : m.model ?? m.comboName ?? m.name ?? m.id)],query));
export const visibleSelectedIds = (rows:{id?:string}[], selected:Set<string>) => rows.filter(r=>r.id && selected.has(r.id)).map(r=>r.id!);
