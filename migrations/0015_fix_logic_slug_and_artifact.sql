-- Keep the remote category slug aligned with the frontend and remove a source footer artifact.
UPDATE categories SET slug='logic', name='逻辑判断', short_name='逻辑' WHERE id=6;
UPDATE questions
SET options_json=json_set(options_json, '$[3].content', '第二张和第四张')
WHERE id=400280;
