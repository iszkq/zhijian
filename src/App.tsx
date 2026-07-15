import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BarChart3, BookCheck, Bookmark, BookmarkCheck, BrainCircuit,
  Check, ChevronDown, ChevronRight, CircleAlert, Clock3, Flame, History, Home as HomeIcon,
  LayoutGrid, Menu, Minus, NotebookTabs, Play, Plus, RotateCcw, Sparkles, Target, Timer,
  Trophy, X, Zap
} from "lucide-react";
import { categories, getQuestions, questions } from "./data";
import { loadAttempts, saveAttempt } from "./storage";
import { fetchCloudAttempts, syncAttempt } from "./api";
import type { AnswerState, Attempt, PracticeConfig, Question, ViewName } from "./types";

const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

const formatDate = (iso: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
}).format(new Date(iso));

function App() {
  const [view, setView] = useState<ViewName>("home");
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [activeConfig, setActiveConfig] = useState<PracticeConfig | null>(null);
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [report, setReport] = useState<Attempt | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts());

  useEffect(() => {
    fetchCloudAttempts().then((cloudItems) => {
      if (!cloudItems.length) return;
      cloudItems.forEach(saveAttempt);
      setAttempts(loadAttempts());
    });
  }, []);

  const navigate = (next: ViewName) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startPractice = (config: PracticeConfig, presetQuestions?: Question[]) => {
    const selected = presetQuestions || getQuestions(config.categoryIds, config.count);
    const initial = Object.fromEntries(selected.map((item) => [item.id, { selected: null, marked: false }]));
    setActiveQuestions(selected);
    setActiveConfig({ ...config, count: selected.length });
    setAnswers(initial);
    setStartedAt(Date.now());
    setReport(null);
    navigate("practice");
  };

  const submitPractice = (automatic = false) => {
    if (!activeConfig || !activeQuestions.length) return;
    const correctCount = activeQuestions.filter((item) => answers[item.id]?.selected === item.answer).length;
    const unansweredCount = activeQuestions.filter((item) => !answers[item.id]?.selected).length;
    const wrongCount = activeQuestions.length - correctCount - unansweredCount;
    const now = new Date();
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const item: Attempt = {
      id: crypto.randomUUID(),
      title: activeConfig.categoryIds.length === 1
        ? `${categories.find((c) => c.id === activeConfig.categoryIds[0])?.name}专项练习`
        : "行测综合训练",
      categoryNames: categories.filter((c) => activeConfig.categoryIds.includes(c.id)).map((c) => c.name),
      questionIds: activeQuestions.map((q) => q.id),
      answers,
      startedAt: new Date(startedAt).toISOString(),
      submittedAt: now.toISOString(),
      durationSeconds,
      timeLimitSeconds: activeConfig.durationMinutes ? activeConfig.durationMinutes * 60 : null,
      correctCount,
      wrongCount,
      unansweredCount,
      score: Math.round((correctCount / activeQuestions.length) * 100)
    };
    saveAttempt(item);
    void syncAttempt(item);
    setAttempts(loadAttempts());
    setReport(item);
    navigate("report");
    if (automatic) setTimeout(() => alert("本组练习时间已到，系统已自动交卷。"), 200);
  };

  const retakeWrong = () => {
    const wrongIds = new Set(attempts.flatMap((a) => a.questionIds.filter((id) => a.answers[id]?.selected && a.answers[id]?.selected !== questions.find((q) => q.id === id)?.answer)));
    const wrongQuestions = questions.filter((q) => wrongIds.has(q.id));
    if (!wrongQuestions.length) return;
    startPractice({ categoryIds: [...new Set(wrongQuestions.map((q) => q.categoryId))], count: wrongQuestions.length, durationMinutes: null }, wrongQuestions);
  };

  return (
    <div className="app-shell">
      {view !== "practice" && <SiteHeader view={view} navigate={navigate} />}
      <main>
        {view === "home" && <Home attempts={attempts} startPractice={startPractice} navigate={navigate} />}
        {view === "practice" && activeConfig && (
          <Practice
            items={activeQuestions}
            config={activeConfig}
            answers={answers}
            setAnswers={setAnswers}
            startedAt={startedAt}
            onBack={() => navigate("home")}
            onSubmit={submitPractice}
          />
        )}
        {view === "report" && report && <Report attempt={report} navigate={navigate} onRetry={() => startPractice(activeConfig!, activeQuestions)} />}
        {view === "history" && <HistoryView attempts={attempts} setReport={setReport} navigate={navigate} />}
        {view === "wrongbook" && <WrongBook attempts={attempts} onPractice={retakeWrong} navigate={navigate} />}
      </main>
    </div>
  );
}

function SiteHeader({ view, navigate }: { view: ViewName; navigate: (v: ViewName) => void }) {
  const [open, setOpen] = useState(false);
  const links: { id: ViewName; label: string; icon: typeof HomeIcon }[] = [
    { id: "home", label: "刷题首页", icon: HomeIcon },
    { id: "history", label: "练习记录", icon: History },
    { id: "wrongbook", label: "错题本", icon: NotebookTabs }
  ];
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" onClick={() => navigate("home")}>
          <span className="brand-mark"><BrainCircuit size={23} /></span>
          <span>知简</span>
        </button>
        <nav className={open ? "nav-links open" : "nav-links"}>
          {links.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => { navigate(id); setOpen(false); }}>
              <Icon size={17} />{label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <span className="streak"><Flame size={17} /> 今日已坚持</span>
          <span className="avatar">行</span>
          <button className="icon-button mobile-menu" onClick={() => setOpen((v) => !v)} aria-label="打开菜单"><Menu size={21} /></button>
        </div>
      </div>
    </header>
  );
}

function Home({ attempts, startPractice, navigate }: {
  attempts: Attempt[];
  startPractice: (c: PracticeConfig) => void;
  navigate: (v: ViewName) => void;
}) {
  const [selected, setSelected] = useState<number[]>(categories.map((c) => c.id));
  const [count, setCount] = useState(10);
  const [duration, setDuration] = useState<number | null>(null);
  const totalAvailable = categories.filter((c) => selected.includes(c.id)).reduce((sum, c) => sum + c.questionCount, 0);
  const totalAnswered = attempts.reduce((sum, a) => sum + a.questionIds.length, 0);
  const totalCorrect = attempts.reduce((sum, a) => sum + a.correctCount, 0);
  const accuracy = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const toggleCategory = (id: number) => {
    setSelected((prev) => prev.includes(id) ? (prev.length === 1 ? prev : prev.filter((item) => item !== id)) : [...prev, id]);
  };

  return (
    <div className="home-page page-width">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={15} /> 每一次练习，都算数</span>
          <h1>今天，从一道好题开始。</h1>
          <p>按你的节奏专项突破，系统记录每一步进步。</p>
          <div className="hero-stats">
            <div><strong>{totalAnswered}</strong><span>累计答题</span></div>
            <i />
            <div><strong>{accuracy || "—"}{accuracy ? "%" : ""}</strong><span>综合正确率</span></div>
            <i />
            <div><strong>{attempts.length}</strong><span>完成练习</span></div>
          </div>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="float-card card-a"><Target /><span><b>目标明确</b>稳步提分</span></div>
          <div className="float-card card-b"><Trophy /><span><b>{accuracy || 0}%</b>本周正确率</span></div>
          <div className="hero-circle"><BookCheck size={48} /><span>公考行测</span><b>每日一练</b></div>
        </div>
      </section>

      <section className="practice-builder">
        <div className="section-heading">
          <div><span className="section-icon"><Zap size={20} /></span><div><h2>开始一组练习</h2><p>自由组合题型，定制你的训练节奏</p></div></div>
          <span className="available">当前可选 {totalAvailable} 题</span>
        </div>

        <div className="builder-block">
          <div className="builder-label"><span>1</span><div><b>选择题型</b><small>可多选</small></div><button onClick={() => setSelected(categories.map((c) => c.id))}>全选</button></div>
          <div className="category-picker">
            {categories.map((category) => {
              const active = selected.includes(category.id);
              return (
                <button key={category.id} className={active ? "category-choice active" : "category-choice"} onClick={() => toggleCategory(category.id)} style={{ "--cat": category.color, "--soft": category.softColor } as React.CSSProperties}>
                  <span className="choice-check">{active && <Check size={13} strokeWidth={3} />}</span>
                  <span className="choice-symbol">{category.shortName.slice(0, 1)}</span>
                  <span><b>{category.name}</b><small>{category.questionCount} 题可练</small></span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="builder-options">
          <div className="builder-block compact">
            <div className="builder-label"><span>2</span><div><b>题目数量</b><small>本组练习题数</small></div></div>
            <div className="count-control">
              <button onClick={() => setCount(Math.max(1, count - 5))}><Minus size={18} /></button>
              <div><strong>{Math.min(count, totalAvailable)}</strong><span>题</span></div>
              <button onClick={() => setCount(Math.min(totalAvailable, count + 5))}><Plus size={18} /></button>
            </div>
            <div className="quick-values">{[5, 10, 15, 20].filter((v) => v <= totalAvailable).map((v) => <button key={v} className={count === v ? "active" : ""} onClick={() => setCount(v)}>{v}题</button>)}</div>
          </div>
          <div className="builder-block compact">
            <div className="builder-label"><span>3</span><div><b>限时设置</b><small>到时自动交卷</small></div></div>
            <div className="time-values">
              {[null, 10, 20, 30, 60].map((v) => <button key={v ?? "none"} className={duration === v ? "active" : ""} onClick={() => setDuration(v)}>{v ? `${v}分钟` : "不限时"}</button>)}
            </div>
          </div>
        </div>

        <div className="builder-footer">
          <div><Clock3 size={18} /><span>预计用时 <b>{duration ? `${duration} 分钟` : `约 ${Math.max(5, Math.ceil(Math.min(count, totalAvailable) * 1.2))} 分钟`}</b></span></div>
          <button className="primary-button start-button" onClick={() => startPractice({ categoryIds: selected, count: Math.min(count, totalAvailable), durationMinutes: duration })}>
            开始答题 <ArrowRight size={19} />
          </button>
        </div>
      </section>

      <section className="dashboard-row">
        <div className="category-section">
          <div className="mini-heading"><div><LayoutGrid size={19} /><h2>专项题库</h2></div><span>针对薄弱项逐个击破</span></div>
          <div className="category-cards">
            {categories.map((category) => (
              <button key={category.id} className="category-card" style={{ "--cat": category.color, "--soft": category.softColor } as React.CSSProperties} onClick={() => startPractice({ categoryIds: [category.id], count: 5, durationMinutes: null })}>
                <span className="category-glyph">{category.shortName.slice(0, 1)}</span>
                <span><b>{category.name}</b><small>{category.description}</small></span>
                <ChevronRight size={19} />
              </button>
            ))}
          </div>
        </div>
        <aside className="recent-panel">
          <div className="mini-heading"><div><History size={19} /><h2>最近练习</h2></div>{attempts.length > 0 && <button onClick={() => navigate("history")}>全部</button>}</div>
          {attempts.length ? attempts.slice(0, 3).map((a) => (
            <button className="recent-item" key={a.id} onClick={() => navigate("history")}>
              <span className={a.score >= 60 ? "score good" : "score"}>{a.score}<small>分</small></span>
              <span><b>{a.title}</b><small>{formatDate(a.submittedAt)} · {a.questionIds.length}题</small></span>
              <ChevronRight size={17} />
            </button>
          )) : <div className="empty-mini"><span><Play size={22} /></span><b>还没有练习记录</b><p>完成第一组练习后，进步会显示在这里</p></div>}
        </aside>
      </section>
    </div>
  );
}

function Practice({ items, config, answers, setAnswers, startedAt, onBack, onSubmit }: {
  items: Question[];
  config: PracticeConfig;
  answers: Record<number, AnswerState>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<number, AnswerState>>>;
  startedAt: number;
  onBack: () => void;
  onSubmit: (automatic?: boolean) => void;
}) {
  const [elapsed, setElapsed] = useState(Math.round((Date.now() - startedAt) / 1000));
  const [current, setCurrent] = useState(0);
  const submitted = useRef(false);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const answeredCount = Object.values(answers).filter((a) => a.selected).length;
  const remaining = config.durationMinutes ? config.durationMinutes * 60 - elapsed : null;

  useEffect(() => {
    const interval = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !submitted.current) {
      submitted.current = true;
      onSubmit(true);
    }
  }, [remaining, onSubmit]);

  const jump = (index: number) => {
    setCurrent(index);
    refs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const answer = (id: number, label: string) => setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], selected: label } }));
  const mark = (id: number) => setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], marked: !prev[id]?.marked } }));

  return (
    <div className="practice-page">
      <header className="exam-header">
        <div className="exam-header-inner">
          <button className="back-button" onClick={() => { if (confirm("退出后，本次答题进度不会保留，确定退出吗？")) onBack(); }}><ArrowLeft size={19} />退出练习</button>
          <div className="exam-title"><span>行测练习</span><i />{config.categoryIds.length === 1 ? categories.find((c) => c.id === config.categoryIds[0])?.name : "综合训练"}</div>
          <div className={remaining !== null && remaining < 60 ? "exam-timer danger" : "exam-timer"}><Timer size={19} /><span>{remaining === null ? formatTime(elapsed) : formatTime(remaining)}</span><small>{remaining === null ? "已用时" : "剩余"}</small></div>
        </div>
        <div className="top-progress"><span style={{ width: `${(answeredCount / items.length) * 100}%` }} /></div>
      </header>
      <div className="exam-layout page-width">
        <div className="question-list">
          {items.map((item, index) => (
            <article className="question-card" key={item.id} ref={(node) => { refs.current[index] = node; }}>
              <div className="question-meta">
                <div><span className="question-no">{index + 1}<small>/{items.length}</small></span><span className="type-tag">{item.type}</span><span className="point-tag">1分</span></div>
                <button className={answers[item.id]?.marked ? "mark-button active" : "mark-button"} onClick={() => mark(item.id)}>{answers[item.id]?.marked ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}<span>{answers[item.id]?.marked ? "已标记" : "标记"}</span></button>
              </div>
              <p className="question-stem">{item.stem}</p>
              <div className="option-grid">
                {item.options.map((option) => (
                  <button key={option.label} className={answers[item.id]?.selected === option.label ? "option active" : "option"} onClick={() => answer(item.id, option.label)}>
                    <span>{option.label}</span><b>{option.content}</b>{answers[item.id]?.selected === option.label && <Check size={18} />}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
        <aside className="answer-panel">
          <div className="answer-panel-head"><div><LayoutGrid size={18} /><b>答题卡</b></div><span>{answeredCount}/{items.length}</span></div>
          <div className="answer-legend"><span><i className="done" />已答</span><span><i />未答</span><span><i className="marked" />标记</span></div>
          <div className="answer-grid">
            {items.map((item, i) => <button key={item.id} className={`${answers[item.id]?.selected ? "done" : ""} ${answers[item.id]?.marked ? "marked" : ""} ${current === i ? "current" : ""}`} onClick={() => jump(i)}>{i + 1}</button>)}
          </div>
          <div className="answer-summary"><span>已答 <b>{answeredCount}</b></span><span>未答 <b>{items.length - answeredCount}</b></span></div>
          <button className="primary-button submit-button" onClick={() => { if (answeredCount === items.length || confirm(`还有 ${items.length - answeredCount} 道题未作答，确定交卷吗？`)) onSubmit(); }}>交卷并查看结果</button>
          <p className="submit-note">交卷后可查看答案与详细解析</p>
        </aside>
      </div>
      <div className="mobile-exam-bar">
        <button onClick={() => jump(Math.max(0, current - 1))}><ArrowLeft size={18} />上一题</button>
        <span>{answeredCount}/{items.length}</span>
        <button className="mobile-submit" onClick={() => onSubmit()}>交卷</button>
        <button onClick={() => jump(Math.min(items.length - 1, current + 1))}>下一题<ArrowRight size={18} /></button>
      </div>
    </div>
  );
}

function Report({ attempt, navigate, onRetry }: { attempt: Attempt; navigate: (v: ViewName) => void; onRetry: () => void }) {
  const [filter, setFilter] = useState<"all" | "wrong" | "correct">("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const items = attempt.questionIds.map((id) => questions.find((q) => q.id === id)!).filter(Boolean);
  const filtered = items.filter((item) => {
    const selected = attempt.answers[item.id]?.selected;
    if (filter === "correct") return selected === item.answer;
    if (filter === "wrong") return selected !== item.answer;
    return true;
  });
  const accuracy = Math.round((attempt.correctCount / items.length) * 100);
  const toggle = (id: number) => setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <div className="report-page page-width">
      <div className="report-heading"><div><button className="back-square" onClick={() => navigate("home")}><ArrowLeft size={20} /></button><div><h1>答题报告</h1><p>{attempt.title} · {formatDate(attempt.submittedAt)}</p></div></div><button className="ghost-button" onClick={onRetry}><RotateCcw size={17} />再练一组</button></div>
      <section className="score-overview">
        <div className="score-main">
          <div className="score-ring" style={{ "--score": `${attempt.score * 3.6}deg` } as React.CSSProperties}><div><strong>{attempt.score}</strong><span>本次得分</span></div></div>
          <div><span className="result-badge">{attempt.score >= 80 ? "状态很棒" : attempt.score >= 60 ? "继续保持" : "再接再厉"}</span><h2>{attempt.score >= 80 ? "优秀！知识掌握很扎实" : "每道错题，都是提分入口"}</h2><p>{attempt.score >= 60 ? "整体表现不错，复盘错题后再练一组吧。" : "建议结合解析查漏补缺，别急着追求速度。"}</p></div>
        </div>
        <div className="score-stats">
          <div><span className="stat-icon green"><Check /></span><strong>{attempt.correctCount}</strong><small>答对</small></div>
          <div><span className="stat-icon red"><X /></span><strong>{attempt.wrongCount}</strong><small>答错</small></div>
          <div><span className="stat-icon gray"><CircleAlert /></span><strong>{attempt.unansweredCount}</strong><small>未答</small></div>
          <div><span className="stat-icon purple"><Clock3 /></span><strong>{formatTime(attempt.durationSeconds)}</strong><small>用时</small></div>
          <div><span className="stat-icon orange"><Target /></span><strong>{accuracy}%</strong><small>正确率</small></div>
        </div>
      </section>

      <div className="report-body">
        <section className="review-list">
          <div className="review-toolbar"><div><h2>答题详情</h2><span>逐题复盘，弄懂比做完更重要</span></div><div className="filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 {items.length}</button><button className={filter === "wrong" ? "active" : ""} onClick={() => setFilter("wrong")}>错题 {attempt.wrongCount + attempt.unansweredCount}</button><button className={filter === "correct" ? "active" : ""} onClick={() => setFilter("correct")}>正确 {attempt.correctCount}</button></div></div>
          {filtered.map((item) => {
            const index = items.findIndex((q) => q.id === item.id);
            const selected = attempt.answers[item.id]?.selected;
            const correct = selected === item.answer;
            return <article className={`review-card ${correct ? "correct" : "wrong"}`} key={item.id}>
              <div className="review-meta"><div><span className="result-stamp">{correct ? <Check size={18} /> : <X size={18} />}{correct ? "正确" : selected ? "错误" : "未答"}</span><span>{index + 1}/{items.length}</span><span>{item.type}</span><span>{item.categoryName}</span></div><b>{correct ? "+1分" : "0分"}</b></div>
              <p className="review-stem">{item.stem}</p>
              <div className="review-options">{item.options.map((option) => {
                const isAnswer = option.label === item.answer;
                const isSelected = option.label === selected;
                return <div key={option.label} className={`${isAnswer ? "answer" : ""} ${isSelected && !isAnswer ? "chosen-wrong" : ""}`}><span>{option.label}</span><b>{option.content}</b>{isAnswer && <em><Check size={14} />正确答案</em>}{isSelected && !isAnswer && <em><X size={14} />你的答案</em>}</div>;
              })}</div>
              <button className="analysis-toggle" onClick={() => toggle(item.id)}><BookCheck size={17} />{expanded.has(item.id) ? "收起解析" : "查看解析"}<ChevronDown size={17} className={expanded.has(item.id) ? "up" : ""} /></button>
              {expanded.has(item.id) && <div className="analysis-box"><div><b>答案</b><span>{item.answer}</span><i />难度：{item.difficulty}<i />来源：{item.source}</div><p><strong>解析</strong>{item.explanation}</p></div>}
            </article>;
          })}
        </section>
        <aside className="report-side">
          <div className="side-card"><h3>答题分布</h3><div className="mini-answer-grid">{items.map((item, i) => { const a = attempt.answers[item.id]?.selected; return <button key={item.id} className={a === item.answer ? "correct" : a ? "wrong" : "empty"}>{i + 1}</button>; })}</div><div className="side-legend"><span><i className="correct" />正确</span><span><i className="wrong" />错误</span><span><i />未答</span></div></div>
          <div className="side-card tip-card"><Sparkles size={22} /><div><h3>复盘建议</h3><p>{attempt.wrongCount ? `本次有 ${attempt.wrongCount} 道错题，建议先看解析，再到错题本集中巩固。` : "本组全部答对，可以尝试更高难度或开启限时训练。"}</p></div></div>
          <button className="primary-button full" onClick={() => navigate("wrongbook")}>进入错题本 <ArrowRight size={17} /></button>
        </aside>
      </div>
    </div>
  );
}

function HistoryView({ attempts, setReport, navigate }: { attempts: Attempt[]; setReport: (a: Attempt) => void; navigate: (v: ViewName) => void }) {
  const total = attempts.reduce((s, a) => s + a.questionIds.length, 0);
  const accuracy = total ? Math.round(attempts.reduce((s, a) => s + a.correctCount, 0) / total * 100) : 0;
  return <div className="records-page page-width">
    <PageTitle icon={History} title="练习记录" subtitle="每一次认真作答，都在积累上岸的底气" />
    <div className="record-stats"><div><BookCheck /><span><strong>{attempts.length}</strong>完成练习</span></div><div><Target /><span><strong>{total}</strong>累计答题</span></div><div><BarChart3 /><span><strong>{accuracy || "—"}{accuracy ? "%" : ""}</strong>综合正确率</span></div></div>
    {attempts.length ? <div className="record-list">{attempts.map((a) => <button className="record-row" key={a.id} onClick={() => { setReport(a); navigate("report"); }}><span className={`record-score ${a.score >= 80 ? "great" : a.score >= 60 ? "good" : ""}`}><strong>{a.score}</strong>分</span><span className="record-info"><b>{a.title}</b><small>{a.categoryNames.join(" · ")}</small></span><span className="record-data"><b>{a.correctCount}/{a.questionIds.length}</b><small>答对题数</small></span><span className="record-data"><b>{formatTime(a.durationSeconds)}</b><small>答题用时</small></span><span className="record-date">{formatDate(a.submittedAt)}</span><ChevronRight /></button>)}</div> : <EmptyState icon={History} title="还没有练习记录" text="选一组题开始练习，你的成绩变化会保存在这里" action="开始刷题" onClick={() => navigate("home")} />}
  </div>;
}

function WrongBook({ attempts, onPractice, navigate }: { attempts: Attempt[]; onPractice: () => void; navigate: (v: ViewName) => void }) {
  const wrongMap = useMemo(() => {
    const map = new Map<number, { count: number; lastAt: string }>();
    attempts.forEach((a) => a.questionIds.forEach((id) => {
      const selected = a.answers[id]?.selected;
      const answer = questions.find((q) => q.id === id)?.answer;
      if (selected && selected !== answer) {
        const old = map.get(id);
        map.set(id, { count: (old?.count || 0) + 1, lastAt: old?.lastAt || a.submittedAt });
      }
    }));
    return map;
  }, [attempts]);
  const wrongItems = [...wrongMap.entries()].map(([id, meta]) => ({ question: questions.find((q) => q.id === id)!, ...meta })).filter((x) => x.question);
  return <div className="records-page page-width">
    <div className="wrong-title-row"><PageTitle icon={NotebookTabs} title="错题本" subtitle="定期回看错题，把不会的真正变成会的" />{wrongItems.length > 0 && <button className="primary-button" onClick={onPractice}><Play size={17} />错题重练</button>}</div>
    <div className="wrong-summary"><div><span className="warm-icon"><Flame /></span><div><strong>{wrongItems.length}</strong><p>待巩固错题</p></div></div><p>错题不是失败，而是系统帮你标出的提分重点。建议完成解析复盘后，间隔练习直到稳定答对。</p></div>
    {wrongItems.length ? <div className="wrong-list">{wrongItems.map(({ question, count, lastAt }, index) => <article className="wrong-row" key={question.id}><span className="wrong-index">{String(index + 1).padStart(2, "0")}</span><div><div className="wrong-meta"><span>{question.categoryName}</span><span>{question.difficulty}</span><em>累计错 {count} 次</em></div><p>{question.stem}</p><small>最近错题：{formatDate(lastAt)}</small></div><span className="answer-chip">答案 {question.answer}</span></article>)}</div> : <EmptyState icon={NotebookTabs} title="错题本还是空的" text="答错的题目会自动收录到这里，方便你集中复习" action="去做一组题" onClick={() => navigate("home")} />}
  </div>;
}

function PageTitle({ icon: Icon, title, subtitle }: { icon: typeof History; title: string; subtitle: string }) {
  return <div className="page-title"><span><Icon /></span><div><h1>{title}</h1><p>{subtitle}</p></div></div>;
}

function EmptyState({ icon: Icon, title, text, action, onClick }: { icon: typeof History; title: string; text: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><span><Icon size={31} /></span><h2>{title}</h2><p>{text}</p><button className="primary-button" onClick={onClick}>{action}<ArrowRight size={17} /></button></div>;
}

export default App;
