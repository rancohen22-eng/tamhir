'use strict';
const knex = require('../db');

/*
 * זריעת מבנה תזרים מזומנים ברירת-מחדל (שיטה עקיפה) לחברה.
 * שינויי הון חוזר מקושרים אוטומטית לשורות המאזן (bs_move); שאר השורות ידניות
 * (מגיעות מניירות עבודה/מודולים אחרים) — ניתן לקשר או להזין ידנית.
 */

// מבנה סטנדרטי. bs = מילת מפתח לשורת מאזן לקישור bs_move; sign לפי כיוון תרומה לתזרים.
const TEMPLATE = [
  { section: 'operating_adj', label: 'רווח (הפסד) נקי לתקופה', source_type: 'netprofit', sign: 1 },
  { section: 'operating_adj', label: 'פחת והפחתות', source_type: 'manual', sign: 1 },
  { section: 'operating_adj', label: 'הוצאות (הכנסות) מימון, נטו', source_type: 'manual', sign: 1 },
  { section: 'operating_adj', label: 'הפסד (רווח) ממימוש רכוש קבוע', source_type: 'manual', sign: 1 },
  { section: 'operating_adj', label: 'מסים על ההכנסה', source_type: 'manual', sign: 1 },
  { section: 'operating_adj', label: 'סה"כ התאמות', source_type: 'manual', sign: 1, is_subtotal: true },

  { section: 'operating_wc', label: 'ירידה (עלייה) בלקוחות', bs: 'לקוחות', sign: -1 },
  { section: 'operating_wc', label: 'ירידה (עלייה) בחייבים ויתרות חובה', bs: 'חייבים ויתרות', sign: -1 },
  { section: 'operating_wc', label: 'עלייה (ירידה) בספקים ונותני שירותים', bs: 'ספקים', sign: 1 },
  { section: 'operating_wc', label: 'עלייה (ירידה) בזכאים ויתרות זכות', bs: 'זכאים ויתרות זכות', sign: 1 },
  { section: 'operating_wc', label: 'סה"כ שינויים בהון חוזר', source_type: 'manual', sign: 1, is_subtotal: true },

  { section: 'operating_cash', label: 'ריבית ששולמה, נטו', source_type: 'manual', sign: 1 },
  { section: 'operating_cash', label: 'מיסים ששולמו (התקבלו), נטו', source_type: 'manual', sign: 1 },
  { section: 'operating_cash', label: 'סה"כ מזומנים ששולמו/התקבלו', source_type: 'manual', sign: 1, is_subtotal: true },

  { section: 'investing', label: 'רכישת רכוש קבוע', source_type: 'manual', sign: 1 },
  { section: 'investing', label: 'תמורה ממימוש רכוש קבוע', source_type: 'manual', sign: 1 },
  { section: 'investing', label: 'תנועה נטו בפקדונות לזמן ארוך', source_type: 'manual', sign: 1 },

  { section: 'financing', label: 'פרעון התחייבויות בגין חכירה', source_type: 'manual', sign: 1 },
  { section: 'financing', label: 'פרעון הלוואות לזמן ארוך', source_type: 'manual', sign: 1 },
  { section: 'financing', label: 'קבלת הלוואות לזמן ארוך', source_type: 'manual', sign: 1 },
  { section: 'financing', label: 'תנועה באשראי לזמן קצר', source_type: 'manual', sign: 1 },

  { section: 'fx', label: 'הפרשי שער בגין יתרות מזומנים', source_type: 'manual', sign: 1 },
];

async function seedCashflow(companyId, { rebuild = false } = {}) {
  const existing = await knex('cashflow_lines').where({ company_id: companyId });
  if (existing.length && !rebuild) return { skipped: true, existing: existing.length };
  if (rebuild) await knex('cashflow_lines').where({ company_id: companyId }).del();

  // שורות מאזן לקישור bs_move לפי מילת מפתח
  const balanceLines = await knex('fs_lines').where({ company_id: companyId, statement: 'balance', kind: 'line' });
  const findBs = (kw) => { const l = balanceLines.find((x) => x.label.includes(kw)); return l ? l.id : null; };

  let order = 0; let created = 0;
  for (const t of TEMPLATE) {
    const row = {
      company_id: companyId, section: t.section, sort_order: order++, label: t.label,
      source_type: t.source_type || (t.bs ? 'bs_move' : 'manual'),
      sign: t.sign || 1, is_subtotal: !!t.is_subtotal,
      source_fs_line_id: t.bs ? findBs(t.bs) : null,
    };
    await knex('cashflow_lines').insert(row);
    created++;
  }
  return { created };
}

module.exports = { seedCashflow, TEMPLATE };
