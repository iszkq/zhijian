-- Attach source diagrams to the three logic questions that require them.
UPDATE questions SET image_key='numeric/20260717/logic/400092.png', details_json=json_set(COALESCE(details_json,'{}'),'$.imageKeys',json_array('numeric/20260717/logic/400092.png'),'$.imageSourcePage',76) WHERE id=400092;
UPDATE questions SET image_key='numeric/20260717/logic/400098.png', details_json=json_set(COALESCE(details_json,'{}'),'$.imageKeys',json_array('numeric/20260717/logic/400098.png'),'$.imageSourcePage',80) WHERE id=400098;
UPDATE questions SET image_key='numeric/20260717/logic/400280.png', details_json=json_set(COALESCE(details_json,'{}'),'$.imageKeys',json_array('numeric/20260717/logic/400280.png'),'$.imageSourcePage',218) WHERE id=400280;
