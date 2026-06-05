import React, { useState } from 'react';
import { UploadZone } from './UploadZone';
import { DocumentCard } from './DocumentCard';
import { HelpCircle, Search } from 'lucide-react';

export const DocumentsPanel = ({
  documents,
  selectedDocIds = [],
  onUpdateSelection,
  uploadProgress,
  onUpload,
  onDeleteDoc,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Filter documents by filename search query
  const filteredDocs = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleToggleSelect = (docId) => {
    const isSelected = selectedDocIds.includes(docId);
    let updated;
    if (isSelected) {
      updated = selectedDocIds.filter((id) => id !== docId);
    } else {
      updated = [...selectedDocIds, docId];
    }
    if (onUpdateSelection) {
      onUpdateSelection(updated);
    }
  };

  const handleSelectAll = () => {
    const filteredIds = filteredDocs.map((doc) => doc.doc_id);
    const newSelection = Array.from(new Set([...selectedDocIds, ...filteredIds]));
    if (onUpdateSelection) {
      onUpdateSelection(newSelection);
    }
  };

  const handleClearSelection = () => {
    if (onUpdateSelection) {
      onUpdateSelection([]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <UploadZone onUpload={onUpload} progress={uploadProgress} />

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          placeholder="Search contracts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 focus:bg-white transition-all text-slate-800"
        />
      </div>

      {/* Bulk Actions and Title */}
      <div className="flex items-center justify-between px-1">
        <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
          Contracts List ({filteredDocs.length})
        </h4>
        {documents.length > 0 && (
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase select-none">
            <button
              onClick={handleSelectAll}
              className="text-blue-650 hover:text-blue-750 cursor-pointer transition-colors"
            >
              Select All
            </button>
            <span className="text-slate-300">|</span>
            <button
              onClick={handleClearSelection}
              className="text-slate-500 hover:text-slate-600 cursor-pointer transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Document Cards List */}
      <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
        {filteredDocs.length === 0 ? (
          <div className="bg-slate-50/50 rounded-xl border border-slate-200 p-6 text-center text-slate-400">
            <HelpCircle className="h-7 w-7 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-semibold">No contracts match</p>
            <p className="text-[10px] text-slate-450 mt-1 leading-normal max-w-[200px] mx-auto">
              {documents.length === 0 
                ? 'Choose a PDF file to begin extracting context segments.' 
                : 'Try adjusting your search criteria.'}
            </p>
          </div>
        ) : (
          filteredDocs.map((doc) => (
            <DocumentCard
              key={doc.doc_id}
              document={doc}
              selected={selectedDocIds.includes(doc.doc_id)}
              onToggleSelect={() => handleToggleSelect(doc.doc_id)}
              onDelete={() => onDeleteDoc(doc.doc_id)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default DocumentsPanel;
