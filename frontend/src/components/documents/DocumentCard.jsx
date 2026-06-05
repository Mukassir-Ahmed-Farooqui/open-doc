import React from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { truncateFilename } from '../../services/api';

export const DocumentCard = ({ document, onDelete, selected, onToggleSelect }) => {
  const handleDeleteClick = (e) => {
    e.stopPropagation();
    const confirm = window.confirm(`Are you sure you want to delete "${document.filename}"? This will permanently delete the agreement and its vector embeddings.`);
    if (confirm) {
      onDelete();
    }
  };

  const truncatedName = truncateFilename(document.filename, 22);

  return (
    <div 
      onClick={onToggleSelect}
      className={`bg-white p-3 rounded-xl border transition-all select-none flex items-center justify-between gap-3 cursor-pointer ${
        selected 
          ? 'border-blue-500 ring-2 ring-blue-50/50 shadow-xs' 
          : 'border-slate-200 hover:border-slate-350 hover:shadow-xs'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {/* Checkbox */}
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
        />

        <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
          <FileText className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p 
            className="text-xs font-bold text-slate-800 truncate" 
            title={document.filename}
          >
            {truncatedName}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] font-mono text-slate-400">
              {document.num_pages} {document.num_pages === 1 ? 'Page' : 'Pages'}
            </span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span className="text-[9px] font-extrabold text-green-600 bg-green-50 px-1 py-0.2 rounded uppercase tracking-wider scale-90 origin-left">
              Indexed
            </span>
          </div>
        </div>
      </div>

      <button
        onClick={handleDeleteClick}
        className="p-1.5 border border-slate-200 hover:border-red-200 text-slate-400 hover:text-red-500 hover:bg-red-50/55 rounded-lg cursor-pointer transition-all shrink-0 bg-white shadow-xs"
        title="Delete contract"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export default DocumentCard;
