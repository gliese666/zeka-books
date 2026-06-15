// normalize.ts — Канонический контракт предметов (зеркало project-zero/src/config/subjects.ts)
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ ДОСЛОВНАЯ КОПИЯ из project-zero/src/config/subjects.ts. Репозитории раздельные,
//    общего пакета нет → синхронизировать вручную при любом изменении ключей.
//    Любое изменение здесь требует и SQL-миграции данных (dim_textbooks_vector.subject).
//
// Канонический `subject` = название предмета на языке книги + класс, БЕЗ языка.
// Язык хранится в metadata.lang, а не в ключе.
// content_hash = md5(subject || '|' || topic || '|' || content) — см. docs/CONTRACT_TEXTBOOKS.md (project-zero)

export type Lang = 'ru' | 'az';

export interface CanonicalSubject {
  subject: string;
  lang: Lang;
  labelRu: string;
}

export const CANONICAL_SUBJECTS: CanonicalSubject[] = [
  { subject: 'Математика 9',           lang: 'ru', labelRu: 'Математика 9'           },
  { subject: 'Coğrafiya 11',           lang: 'az', labelRu: 'География 11 (az)'      },
  { subject: 'История Азербайджана 9', lang: 'ru', labelRu: 'История Азербайджана 9' },
  { subject: 'География 9',            lang: 'ru', labelRu: 'География 9'            },
  { subject: 'Fizika 9',               lang: 'az', labelRu: 'Физика 9'              },
  { subject: 'Kimya 9',                lang: 'az', labelRu: 'Химия 9'               },
  { subject: 'Biologiya 9',            lang: 'az', labelRu: 'Биология 9'            },
];

const CANONICAL_SET = new Set(CANONICAL_SUBJECTS.map((s) => s.subject));

/** Является ли строка точным каноническим ключом. */
export function isCanonicalSubject(s: string): boolean {
  return CANONICAL_SET.has(s);
}

/**
 * Приводит «сырой» subject к каноническому виду:
 * срезает языковой суффикс (рус|aze|ru|az) в конце и лишние пробелы.
 * Пример: 'Coğrafiya 11 aze' → 'Coğrafiya 11', 'География 9 рус' → 'География 9'.
 * Класс не «изобретается» — если в исходнике нет номера, он не добавляется.
 */
export function normalizeSubject(raw: string): string {
  return raw.trim().replace(/\s+(рус|aze|ru|az)$/i, '').trim();
}

/** Язык канонического предмета (для metadata.lang). Дефолт 'ru', если не найден. */
export function subjectLang(subject: string): Lang {
  return CANONICAL_SUBJECTS.find((s) => s.subject === subject)?.lang ?? 'ru';
}
