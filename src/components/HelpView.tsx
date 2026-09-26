import React, { useState } from 'react';
import { Sparkles, BookOpen, ArrowLeft } from 'lucide-react';
import { USER_GUIDE_SECTIONS, GUIDE_UPDATED_AT } from '../content/userGuide';
import { OnboardingModal } from './OnboardingModal';

export const HelpView: React.FC = () => {
  const [showGuide, setShowGuide] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  if (showGuide) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-0">
        <button
          type="button"
          id="btn-back-to-help"
          onClick={() => setShowGuide(false)}
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-brand-ink hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
          Back to Help
        </button>

        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-text">The Docket — User Guide</h1>
          <p className="mt-1 text-[12px] text-text-3">Last updated {GUIDE_UPDATED_AT}</p>
        </div>

        {USER_GUIDE_SECTIONS.map((section) => (
          <section key={section.id} className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-[15px] font-extrabold text-text mb-3">{section.heading}</h2>
            {section.paragraphs?.map((p, i) => (
              <p key={i} className="mb-2.5 text-[13px] leading-relaxed text-text-2 last:mb-0">
                {p}
              </p>
            ))}
            {section.table && (
              <div className="my-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-surface-2">
                    <tr>
                      {section.table.columns.map((c) => (
                        <th key={c} className="px-3 py-2 font-bold text-text">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map((row) => (
                      <tr key={row.label} className="border-t border-line">
                        <td className="px-3 py-2 font-semibold text-text align-top">{row.label}</td>
                        <td className="px-3 py-2 text-text-2 align-top">{row.browser}</td>
                        <td className="px-3 py-2 text-text-2 align-top">{row.cloud}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {section.bullets && (
              <ul className="space-y-2 text-[13px] leading-relaxed text-text-2">
                {section.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-brand-ink">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
            {section.endpointsCalled && (
              <p className="mt-3 border-t border-line pt-2.5 text-[11px] font-mono leading-relaxed text-text-3">
                <span className="font-bold">Endpoints called:</span> {section.endpointsCalled}
              </p>
            )}
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-0">
      <button
        type="button"
        id="btn-start-tour"
        onClick={() => setTourOpen(true)}
        className="flex w-full items-center gap-4 rounded-xl border border-line bg-surface p-5 text-left transition-colors hover:border-brand hover:bg-brand-soft/40"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-brand-soft text-brand-ink">
          <Sparkles className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-[14px] font-extrabold text-text">Take the guided tour</p>
          <p className="mt-0.5 text-[12px] text-text-2">
            A short, six-step walkthrough of what each area of the app does — Engine Configuration, Verified
            Qualifiers, Price Watch, and Archive & Performance.
          </p>
        </div>
      </button>

      <button
        type="button"
        id="btn-open-user-guide"
        onClick={() => setShowGuide(true)}
        className="flex w-full items-center gap-4 rounded-xl border border-line bg-surface p-5 text-left transition-colors hover:border-brand hover:bg-brand-soft/40"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-brand-soft text-brand-ink">
          <BookOpen className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div>
          <p className="text-[14px] font-extrabold text-text">Read the User Guide</p>
          <p className="mt-0.5 text-[12px] text-text-2">
            The full written documentation — exactly what gets downloaded, what gets checked, and where every
            piece of data lives, in plain language.
          </p>
        </div>
      </button>

      <OnboardingModal isOpen={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
};
