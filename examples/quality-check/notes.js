// Small implemented boundary for a manual CFP quality check. Do not execute to assess.
// Persistent SQLite-compatible DB is injected by the host application.
// HTTP authentication, routing, planning and operations are outside this sample.

export function createNote(db, request, response) {
  const { id, title, content } = request.body;
  if (!id || !title) {
    response.status(400).json({ error: "id and title required" });
    return;
  }
  db.prepare("INSERT INTO notes (id, title, content) VALUES (?, ?, ?)")
    .run(id, title, content);
  response.status(201).json({ id, title, content, status: "created" });
}

export function listNotes(db, request, response) {
  const title = request.query.title || "%";
  const notes = db.prepare("SELECT id, title, content FROM notes WHERE title LIKE ?")
    .all(title);
  response.json(notes);
}
