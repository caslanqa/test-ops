import type { CSSProperties, ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import { ThemeSwitcher } from './ThemeSwitcher';

// Sample ribbon on the sign-in and registration screens: not real data, but a decorative
// run illustrating what the product shows (which is why it is hidden from screen readers).
const DEMO_RUN = 'PPPPPFPPPPBPPPPPPPFPPPPSPPPPPPPPFPPPPUUUUUUUUUUU'
  .split('')
  .map((ch) => ({ P: 'passed', F: 'failed', B: 'blocked', S: 'skipped', U: 'untested' })[ch] ?? 'untested');

/** Shared skeleton of signed-out screens: product showcase on the left, form on the right. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      {/* Only the sample ribbon is decorative and hidden; the brand and tagline stay readable. */}
      <section className="login-showcase" aria-label="TestOps">
        <BrandMark />
        <div className="login-ribbon" aria-hidden="true">
          <div className="ribbon ribbon--hero ribbon--cells">
            {DEMO_RUN.map((status, i) => (
              <span
                key={i}
                className={`ribbon-cell status-bg--${status}`}
                style={{ '--i': i } as CSSProperties}
              />
            ))}
          </div>
          <p className="login-ribbon-caption">Each cell is a test case; its color is that case's latest result.</p>
        </div>
        <p className="login-tagline">Manual tests and CI results in the same run, on the same ribbon.</p>
      </section>
      <main className="login-panel">
        <div className="login-theme">
          <ThemeSwitcher />
        </div>
        {children}
      </main>
    </div>
  );
}
