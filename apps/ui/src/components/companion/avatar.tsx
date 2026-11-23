import type { AvatarState } from './types';

interface CompanionAvatarProps {
  state?: AvatarState;
  size?: number;
  label?: string;
  expanded?: boolean;
  onClick?: () => void;
}

export function CompanionAvatar({
  state = 'idle',
  size = 56,
  label = 'Guide - explains the app, not legal advice',
  expanded = false,
  onClick,
}: CompanionAvatarProps) {
  const isThinking = state === 'thinking';
  const isTalking = state === 'talking';

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      className={`courtplus-companion-avatar companion-avatar-${state}`}
      style={{ width: size, height: size, cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
      role={onClick ? undefined : 'img'}
      aria-expanded={onClick ? expanded : undefined}
      aria-label={label}
      data-companion-avatar="true"
      data-companion-state={state}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 56 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="companion-svg"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="cp-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cp-body" x1="10" y1="8" x2="46" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </linearGradient>
          <linearGradient id="cp-visor" x1="14" y1="18" x2="42" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
          <linearGradient id="cp-trim" x1="10" y1="10" x2="46" y2="10" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
        </defs>

        {/* Glow / Ambient shadow */}
        <circle cx="28" cy="28" r="27" fill="url(#cp-halo)" className={isThinking ? 'cp-glow-thinking' : ''} />

        {/* Head / Body shell with breathing */}
        <g className="cp-breathing-group">
          {/* Base outer circle with soft border */}
          <circle cx="28" cy="28" r="23" fill="url(#cp-body)" stroke="#cbd5e1" strokeWidth="1.5" />

          {/* Little judge/guide crest or antenna */}
          <path d="M25 5 L31 5 L29.5 9 L26.5 9 Z" fill="url(#cp-trim)" />
          <circle cx="28" cy="4" r="2.5" fill="#3b82f6" className={isThinking ? 'cp-antenna-pulse' : ''} />

          {/* Inner dark screen visor */}
          <rect x="13" y="16" width="30" height="20" rx="9" fill="url(#cp-visor)" stroke="#334155" strokeWidth="1" />

          {/* Eyes with blink or thinking direction */}
          <g className={`cp-eyes-group ${isThinking ? 'cp-eyes-thinking' : 'cp-eyes-blinking'}`}>
            {/* Left Eye */}
            <circle cx="21" cy="25" r="3.2" fill={isThinking ? '#38bdf8' : '#60a5fa'} />
            <circle cx="22" cy="24" r="1.1" fill="#ffffff" />

            {/* Right Eye */}
            <circle cx="35" cy="25" r="3.2" fill={isThinking ? '#38bdf8' : '#60a5fa'} />
            <circle cx="36" cy="24" r="1.1" fill="#ffffff" />
          </g>

          {/* Talking mouth animation */}
          {isTalking ? (
            <path
              d="M24 31 Q28 35 32 31"
              stroke="#60a5fa"
              strokeWidth="2"
              strokeLinecap="round"
              className="cp-mouth-talking"
            />
          ) : (
            <path
              d="M25 31 Q28 33 31 31"
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}

          {/* Cute subtle blush dots */}
          <circle cx="16" cy="28" r="1.5" fill="#f43f5e" opacity="0.3" />
          <circle cx="40" cy="28" r="1.5" fill="#f43f5e" opacity="0.3" />
        </g>

        {/* Thinking floating dots */}
        {isThinking && (
          <g className="cp-thinking-dots">
            <circle cx="44" cy="11" r="2" fill="#38bdf8" className="cp-dot-1" />
            <circle cx="49" cy="6" r="2.5" fill="#38bdf8" className="cp-dot-2" />
            <circle cx="53" cy="2" r="1.5" fill="#38bdf8" className="cp-dot-3" />
          </g>
        )}
      </svg>
    </Wrapper>
  );
}
