import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ArrowLeft, User, Shield, Moon, Sun, Settings, Compass, Layers } from 'lucide-react';

export const SettingsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Settings states backed by localStorage
  const [theme, setTheme] = useState(localStorage.getItem('cs_theme') || 'light');
  const [defaultWorkspace, setDefaultWorkspace] = useState(localStorage.getItem('cs_default_workspace') || 'all');
  const [summaryStyle, setSummaryStyle] = useState(localStorage.getItem('cs_summary_style') || 'executive');

  // Apply theme class to document element on changes
  useEffect(() => {
    localStorage.setItem('cs_theme', theme);
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Persist selections
  const saveWorkspaceMode = (mode) => {
    setDefaultWorkspace(mode);
    localStorage.setItem('cs_default_workspace', mode);
  };

  const saveSummaryStyle = (style) => {
    setSummaryStyle(style);
    localStorage.setItem('cs_summary_style', style);
  };

  // Extract initials
  const getInitials = (name) => {
    if (!name) return 'LA';
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formattedDate = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'June 5, 2026';

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 dark:bg-slate-950 font-sans overflow-y-auto">
      {/* Top Header */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shrink-0 shadow-md">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white transition-all cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Workspace</span>
        </button>

        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-blue-650 flex items-center justify-center text-white shadow-lg">
            <Settings className="h-4.5 w-4.5" />
          </div>
          <h1 className="text-sm font-extrabold text-white tracking-wider uppercase">
            Platform Settings
          </h1>
        </div>
      </header>

      {/* Main Settings Form Panel */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-6 md:p-8 space-y-8">
        
        {/* Profile Card Section */}
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="h-14 w-14 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg font-extrabold shadow-md uppercase">
              {getInitials(user?.full_name)}
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                {user?.full_name || 'Legal Analyst'}
              </h2>
              <p className="text-xs font-medium text-slate-400 font-mono">
                {user?.email || 'analyst@clausescope.ai'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
                User Role
              </span>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                <span>Standard Legal Auditor</span>
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
                Member Since
              </span>
              <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                {formattedDate}
              </p>
            </div>
          </div>
        </section>

        {/* Configurations Section */}
        <section className="space-y-6">
          <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider px-1">
            System Preferences
          </h3>

          {/* Theme Selector */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <Sun className="h-4.5 w-4.5 text-amber-500" />
              <h4 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Display Theme
              </h4>
            </div>
            <p className="text-[11px] text-slate-400">
              Customize the visual experience of your RAG dashboard workspace.
            </p>

            <div className="grid grid-cols-2 gap-3.5">
              <button
                onClick={() => setTheme('light')}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 cursor-pointer ${
                  theme === 'light'
                    ? 'border-blue-500 bg-blue-50/20 text-blue-600'
                    : 'border-slate-100 dark:border-slate-800 bg-slate-50/30 hover:border-slate-200 text-slate-500'
                }`}
              >
                <Sun className="h-6 w-6" />
                <span className="text-xs font-bold">Classic Light Mode</span>
              </button>

              <button
                onClick={() => setTheme('dark')}
                className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 cursor-pointer ${
                  theme === 'dark'
                    ? 'border-blue-500 bg-slate-800 text-white'
                    : 'border-slate-100 dark:border-slate-800 bg-slate-50/30 hover:border-slate-200 text-slate-500'
                }`}
              >
                <Moon className="h-6 w-6" />
                <span className="text-xs font-bold">Premium Dark Mode</span>
              </button>
            </div>
          </div>

          {/* Default Workspace Mode */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <Compass className="h-4.5 w-4.5 text-blue-650" />
              <h4 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Default Chat Workspace Mode
              </h4>
            </div>
            <p className="text-[11px] text-slate-400">
              Set the default document coverage selection when you initialize a new chat.
            </p>

            <div className="space-y-2.5">
              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-850/50 cursor-pointer transition-all">
                <input
                  type="radio"
                  name="workspace_mode"
                  checked={defaultWorkspace === 'all'}
                  onChange={() => saveWorkspaceMode('all')}
                  className="mt-0.5 h-4 w-4 text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                    All Contracts (Corpus-wide)
                  </span>
                  <span className="text-[10px] text-slate-450 block mt-0.5">
                    Newly created chat history sessions will query all documents owned by default.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-850/50 cursor-pointer transition-all">
                <input
                  type="radio"
                  name="workspace_mode"
                  checked={defaultWorkspace === 'empty'}
                  onChange={() => saveWorkspaceMode('empty')}
                  className="mt-0.5 h-4 w-4 text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                    No Contracts (Start Empty)
                  </span>
                  <span className="text-[10px] text-slate-450 block mt-0.5">
                    Newly created sessions start with an empty checklist. You manually select contracts of interest.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Summary Style selection */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4.5 w-4.5 text-green-650" />
              <h4 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Default Summary Style
              </h4>
            </div>
            <p className="text-[11px] text-slate-400">
              Configure how the synthesis model compiles multi-document or single document summary requests.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { id: 'executive', label: 'Executive Summary', desc: 'Sleek, condensed analysis' },
                { id: 'detailed', label: 'Detailed Outline', desc: 'Clause-by-clause sections' },
                { id: 'highlights', label: 'Key Highlights', desc: 'Bullet list of critical risks' },
              ].map((style) => (
                <button
                  key={style.id}
                  onClick={() => saveSummaryStyle(style.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    summaryStyle === style.id
                      ? 'border-blue-500 bg-blue-50/10 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400'
                      : 'border-slate-100 dark:border-slate-800 hover:border-slate-250 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <span className="text-xs font-bold block">{style.label}</span>
                  <span className="text-[9px] text-slate-450 mt-1 block leading-normal">
                    {style.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default SettingsPage;
