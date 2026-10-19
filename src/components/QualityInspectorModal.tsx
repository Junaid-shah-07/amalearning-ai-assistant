import React from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, X } from 'lucide-react';
import { ComplianceCheckResult } from '../utils/complianceChecker';

interface QualityInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: ComplianceCheckResult[];
  score: number;
  messageText: string;
}

export const QualityInspectorModal: React.FC<QualityInspectorModalProps> = ({
  isOpen,
  onClose,
  results,
  score,
  messageText,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${score >= 80 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 flex items-center gap-2">
                Response Quality Audit
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                  score >= 80 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                }`}>
                  {score}% Compliance
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Audited against Section 22 internal quality rules
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Inspected Message Preview */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-400 mb-1 uppercase tracking-wider">
              Audited Assistant Reply
            </div>
            <p className="text-xs text-slate-200 line-clamp-3 italic">
              "{messageText}"
            </p>
          </div>

          {/* Checklist */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Evaluated Criteria ({results.filter(r => r.passed).length}/{results.length} Passed)
            </h4>
            <div className="grid gap-2">
              {results.map((item) => (
                <div
                  key={item.ruleId}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-xs transition ${
                    item.passed
                      ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-200'
                      : 'bg-amber-950/20 border-amber-900/40 text-amber-200'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {item.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold flex items-center justify-between">
                      <span>{item.label}</span>
                      <span className="text-[10px] opacity-75">Rule #{item.ruleId}</span>
                    </div>
                    <div className="text-[11px] opacity-85 mt-0.5">
                      {item.note}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-900/50 text-blue-200 text-xs">
            <p className="font-medium text-blue-300 mb-1">Guiding Principle:</p>
            <p className="text-[11px] text-blue-200/90 leading-relaxed">
              "Be human in tone, accurate in information, helpful in approach and trustworthy in every response." — Master System Prompt Sec 25
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
          >
            Close Audit
          </button>
        </div>
      </div>
    </div>
  );
};
