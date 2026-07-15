import { useEffect, useMemo, useState } from "react";
import { CircleAlert, FileImage, FolderTree, ImagePlus, ListChecks, Pencil, Plus, Save, Search, ShieldCheck, Trash2, Upload, Users, X } from "lucide-react";
import { adminRequest, uploadQuestionImage } from "./api";
import type { Category, Question } from "./types";

type Tab = "questions" | "categories" | "users";
type AdminCategory = Category & { sortOrder: number };
type AdminQuestion = Question & { categoryName: string; imageKey?: string | null; createdAt?: string; updatedAt?: string };
type AdminUser = { id: string; username: string; displayName: string; role: "user" | "admin"; status: "active" | "disabled"; createdAt: string; attemptCount: number };

const emptyCategory = { id: 0, slug: "", name: "", shortName: "", description: "", color: "#5c5cf6", softColor: "#eeeeff", questionCount: 0, sortOrder: 0 } as AdminCategory;
const labels = ["A", "B", "C", "D"];
const emptyQuestion = (categoryId = 1): AdminQuestion => ({
  id: 0, categoryId, categoryName: "", type: "单选题", stem: "",
  options: labels.map((label) => ({ label, content: "" })), answer: "A", explanation: "",
  source: "自建题库", difficulty: "基础", status: "published", imageKey: null, imageUrl: null
});

export default function Admin({ onCatalogChanged }: { onCatalogChanged: () => void }) {
  const [tab, setTab] = useState<Tab>("questions");
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [categoryEditor, setCategoryEditor] = useState<AdminCategory | null>(null);
  const [questionEditor, setQuestionEditor] = useState<AdminQuestion | null>(null);
  const [userEditor, setUserEditor] = useState<(Partial<AdminUser> & { password?: string; isNew?: boolean }) | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [categoryResult, questionResult, userResult] = await Promise.all([
        adminRequest<{ data: AdminCategory[] }>("/api/admin/categories"),
        adminRequest<{ data: AdminQuestion[] }>("/api/admin/questions"),
        adminRequest<{ data: AdminUser[] }>("/api/admin/users")
      ]);
      setCategories(categoryResult.data); setQuestions(questionResult.data); setUsers(userResult.data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "后台数据加载失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filteredQuestions = useMemo(() => questions.filter((question) => !query || question.stem.toLowerCase().includes(query.toLowerCase()) || question.categoryName.includes(query)), [questions, query]);

  const remove = async (kind: "questions" | "categories" | "users", id: number | string, label: string) => {
    if (!confirm(`确定删除“${label}”吗？此操作无法撤销。`)) return;
    try { await adminRequest(`/api/admin/${kind}/${id}`, { method: "DELETE" }); await load(); if (kind === "categories") onCatalogChanged(); }
    catch (caught) { alert(caught instanceof Error ? caught.message : "删除失败"); }
  };

  return <div className="admin-page page-width">
    <div className="admin-heading"><div><span><ShieldCheck /></span><div><h1>管理后台</h1><p>管理题库内容、分类与用户账号</p></div></div><button onClick={() => void load()}>刷新数据</button></div>
    <div className="admin-stats"><div><ListChecks /><span><strong>{questions.length}</strong>全部题目</span></div><div><FolderTree /><span><strong>{categories.length}</strong>题库分类</span></div><div><Users /><span><strong>{users.length}</strong>注册用户</span></div><div><FileImage /><span><strong>{questions.filter((question) => question.imageKey).length}</strong>含图题目</span></div></div>
    <div className="admin-shell">
      <nav className="admin-tabs"><button className={tab === "questions" ? "active" : ""} onClick={() => setTab("questions")}><ListChecks />题目管理</button><button className={tab === "categories" ? "active" : ""} onClick={() => setTab("categories")}><FolderTree />分类管理</button><button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><Users />账号管理</button></nav>
      <section className="admin-content">
        {error && <div className="admin-error"><CircleAlert />{error}</div>}
        {loading ? <div className="admin-loading">正在加载后台数据…</div> : tab === "questions" ? <>
          <div className="admin-toolbar"><div className="admin-search"><Search /><input placeholder="搜索题干或分类" value={query} onChange={(event) => setQuery(event.target.value)} /></div><button className="primary-button" onClick={() => setQuestionEditor(emptyQuestion(categories[0]?.id))}><Plus />新增题目</button></div>
          <div className="admin-table question-admin-table"><div className="admin-table-head"><span>题目</span><span>分类</span><span>状态</span><span>操作</span></div>{filteredQuestions.map((question) => <div className="admin-table-row" key={question.id}><div className="admin-question-cell">{question.imageUrl && <img src={question.imageUrl} alt="" />}<span><b>{question.stem}</b><small>答案 {question.answer} · {question.difficulty} · {question.source}</small></span></div><span>{question.categoryName}</span><span className={question.status === "published" ? "status-chip active" : "status-chip"}>{question.status === "published" ? "已发布" : "草稿"}</span><span className="row-actions"><button onClick={() => setQuestionEditor(question)}><Pencil /></button><button className="danger" onClick={() => void remove("questions", question.id, question.stem.slice(0, 18))}><Trash2 /></button></span></div>)}</div>
        </> : tab === "categories" ? <>
          <div className="admin-toolbar"><div><h2>题库分类</h2><p>有题目的分类需先清空题目后才能删除</p></div><button className="primary-button" onClick={() => setCategoryEditor({ ...emptyCategory, sortOrder: categories.length + 1 })}><Plus />新增分类</button></div>
          <div className="category-admin-grid">{categories.map((category) => <article key={category.id} style={{ "--cat": category.color, "--soft": category.softColor } as React.CSSProperties}><span className="admin-category-symbol">{category.shortName.slice(0, 1)}</span><div><h3>{category.name}</h3><p>{category.description || "暂无分类说明"}</p><small>{category.questionCount} 道题 · 标识 {category.slug}</small></div><span className="row-actions"><button onClick={() => setCategoryEditor(category)}><Pencil /></button><button className="danger" onClick={() => void remove("categories", category.id, category.name)}><Trash2 /></button></span></article>)}</div>
        </> : <>
          <div className="admin-toolbar"><div><h2>账号管理</h2><p>设置用户状态与管理员权限</p></div><button className="primary-button" onClick={() => setUserEditor({ username: "", displayName: "", password: "", role: "user", status: "active", isNew: true })}><Plus />新增账号</button></div>
          <div className="admin-table user-admin-table"><div className="admin-table-head"><span>用户</span><span>角色</span><span>状态</span><span>练习</span><span>操作</span></div>{users.map((user) => <div className="admin-table-row" key={user.id}><div className="admin-user-cell"><span>{user.displayName.slice(0, 1)}</span><span><b>{user.displayName}</b><small>@{user.username}</small></span></div><span>{user.role === "admin" ? "管理员" : "普通用户"}</span><span className={user.status === "active" ? "status-chip active" : "status-chip disabled"}>{user.status === "active" ? "正常" : "已停用"}</span><span>{user.attemptCount || 0} 次</span><span className="row-actions"><button onClick={() => setUserEditor(user)}><Pencil /></button><button className="danger" onClick={() => void remove("users", user.id, user.displayName)}><Trash2 /></button></span></div>)}</div>
        </>}
      </section>
    </div>
    {categoryEditor && <CategoryEditor value={categoryEditor} onClose={() => setCategoryEditor(null)} onSaved={async () => { setCategoryEditor(null); await load(); onCatalogChanged(); }} />}
    {questionEditor && <QuestionEditor value={questionEditor} categories={categories} onClose={() => setQuestionEditor(null)} onSaved={async () => { setQuestionEditor(null); await load(); }} />}
    {userEditor && <UserEditor value={userEditor} onClose={() => setUserEditor(null)} onSaved={async () => { setUserEditor(null); await load(); }} />}
  </div>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="admin-modal-backdrop"><div className="admin-modal"><div className="admin-modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose}><X /></button></div>{children}</div></div>;
}

function CategoryEditor({ value, onClose, onSaved }: { value: AdminCategory; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(value); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await adminRequest(`/api/admin/categories${form.id ? `/${form.id}` : ""}`, { method: form.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); } finally { setSaving(false); } };
  return <Modal title={form.id ? "编辑分类" : "新增分类"} subtitle="分类将显示在前台组卷和专项题库中" onClose={onClose}><form className="admin-form" onSubmit={save}><div className="form-grid"><label><span>分类名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label><label><span>简称</span><input value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} maxLength={8} required /></label><label><span>英文标识</span><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="例如 law" required /></label><label><span>排序</span><input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></label><label className="span-two"><span>分类说明</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><label><span>主色</span><input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label><label><span>浅色背景</span><input type="color" value={form.softColor} onChange={(e) => setForm({ ...form, softColor: e.target.value })} /></label></div>{error && <div className="admin-error"><CircleAlert />{error}</div>}<div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}><Save />{saving ? "保存中…" : "保存分类"}</button></div></form></Modal>;
}

function QuestionEditor({ value, categories, onClose, onSaved }: { value: AdminQuestion; categories: AdminCategory[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(value); const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState(value.imageUrl || ""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const updateOption = (index: number, content: string) => setForm({ ...form, options: form.options.map((option, position) => position === index ? { ...option, content } : option) });
  const pickFile = (event: React.ChangeEvent<HTMLInputElement>) => { const next = event.target.files?.[0]; if (!next) return; setFile(next); setPreview(URL.createObjectURL(next)); };
  const save = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { let imageKey = form.imageKey || null; if (file) imageKey = (await uploadQuestionImage(file)).key; const body = { ...form, imageKey, categoryId: Number(form.categoryId) }; await adminRequest(`/api/admin/questions${form.id ? `/${form.id}` : ""}`, { method: form.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); } finally { setSaving(false); } };
  return <Modal title={form.id ? "编辑题目" : "新增题目"} subtitle="题目图片可选，上传后显示在题干上方" onClose={onClose}><form className="admin-form question-form" onSubmit={save}><div className="form-grid"><label><span>所属分类</span><select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label><span>难度</span><select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Question["difficulty"] })}><option>基础</option><option>进阶</option><option>挑战</option></select></label><label><span>状态</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "published" | "draft" })}><option value="published">发布</option><option value="draft">草稿</option></select></label><label><span>来源</span><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></label><label className="span-two"><span>题干</span><textarea value={form.stem} onChange={(e) => setForm({ ...form, stem: e.target.value })} rows={4} required /></label></div><div className="image-uploader">{preview ? <img src={preview} alt="题目预览" /> : <span><ImagePlus /><b>可选题目配图</b><small>支持 JPG、PNG、WebP，最大 5MB</small></span>}<label><Upload />选择图片<input type="file" accept="image/*" onChange={pickFile} /></label>{preview && <button type="button" onClick={() => { setPreview(""); setFile(null); setForm({ ...form, imageKey: null, imageUrl: null }); }}>移除图片</button>}</div><div className="option-editor"><h3>选项与答案</h3>{form.options.map((option, index) => <label key={option.label}><input type="radio" name="answer" checked={form.answer === option.label} onChange={() => setForm({ ...form, answer: option.label })} /><span>{option.label}</span><input value={option.content} onChange={(e) => updateOption(index, e.target.value)} placeholder={`选项 ${option.label}`} required /></label>)}</div><label className="full-label"><span>题目解析</span><textarea value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} rows={5} required /></label>{error && <div className="admin-error"><CircleAlert />{error}</div>}<div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}><Save />{saving ? "保存中…" : "保存题目"}</button></div></form></Modal>;
}

function UserEditor({ value, onClose, onSaved }: { value: Partial<AdminUser> & { password?: string; isNew?: boolean }; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(value); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { const body = form.isNew ? { username: form.username, displayName: form.displayName, password: form.password, role: form.role } : { displayName: form.displayName, role: form.role, status: form.status }; await adminRequest(`/api/admin/users${form.isNew ? "" : `/${form.id}`}`, { method: form.isNew ? "POST" : "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); } finally { setSaving(false); } };
  return <Modal title={form.isNew ? "新增账号" : "编辑账号"} subtitle="管理员可以管理题库和其他账号" onClose={onClose}><form className="admin-form" onSubmit={save}><div className="form-grid"><label><span>昵称</span><input value={form.displayName || ""} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required /></label>{form.isNew && <label><span>登录账号</span><input value={form.username || ""} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>}{form.isNew && <label><span>初始密码</span><input type="password" minLength={8} value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>}<label><span>角色</span><select value={form.role || "user"} onChange={(e) => setForm({ ...form, role: e.target.value as "user" | "admin" })}><option value="user">普通用户</option><option value="admin">管理员</option></select></label>{!form.isNew && <label><span>账号状态</span><select value={form.status || "active"} onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "disabled" })}><option value="active">正常</option><option value="disabled">停用</option></select></label>}</div>{error && <div className="admin-error"><CircleAlert />{error}</div>}<div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}><Save />{saving ? "保存中…" : "保存账号"}</button></div></form></Modal>;
}
