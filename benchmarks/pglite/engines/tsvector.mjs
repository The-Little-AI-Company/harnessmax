export const name = "tsvector";

export async function prepare(db) {
  await db.exec(`
    ALTER TABLE documents ADD COLUMN tsv tsvector;
    UPDATE documents SET tsv = to_tsvector(
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || body
    );
    CREATE INDEX documents_tsv_idx ON documents USING GIN(tsv);
  `);
}

export async function query(db, text) {
  const result = await db.query(`
    SELECT path FROM documents, websearch_to_tsquery($1) AS search
    WHERE tsv @@ search
    ORDER BY ts_rank(tsv, search) DESC, path
    LIMIT 10
  `, [text]);
  return result.rows.map(row => row.path);
}
