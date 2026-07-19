export type AssignmentVisualKind = "assignment" | "authorship" | "evidence" | "rubric";

export function AssignmentIntelligenceVisual({ kind }: { kind: AssignmentVisualKind }) {
  if (kind === "assignment") {
    return (
      <svg aria-hidden="true" className="assignment-intelligence__visual" focusable="false" viewBox="0 0 300 92">
        <defs>
          <linearGradient id="assignment-page" x1="0" x2="1" y1="0" y2="1">
            <stop stopColor="#EAF1FF" />
            <stop offset="1" stopColor="#FFFFFF" />
          </linearGradient>
          <linearGradient id="assignment-check" x1="0" x2="1">
            <stop stopColor="#0015D6" />
            <stop offset="1" stopColor="#0989FB" />
          </linearGradient>
        </defs>
        <g transform="translate(25 20) rotate(-7 32 27)">
          <rect fill="#FFFFFF" height="54" rx="9" stroke="#D9E5F8" width="64" />
          <rect fill="#CFE0FF" height="6" rx="3" width="26" x="11" y="12" />
          <rect fill="#E8EEF7" height="4" rx="2" width="42" x="11" y="25" />
          <rect fill="#E8EEF7" height="4" rx="2" width="34" x="11" y="35" />
        </g>
        <g transform="translate(104 10)">
          <rect fill="url(#assignment-page)" height="72" rx="12" stroke="#C7D9F5" width="92" />
          <rect fill="#FFFFFF" height="8" rx="4" width="48" x="15" y="14" />
          <rect fill="#D8E5FB" height="5" rx="2.5" width="62" x="15" y="32" />
          <rect fill="#D8E5FB" height="5" rx="2.5" width="49" x="15" y="43" />
          <circle cx="72" cy="55" fill="url(#assignment-check)" r="12" />
          <path d="m67 55 3.4 3.4 7-8" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        </g>
        <g transform="translate(216 19) rotate(7 29 27)">
          <rect fill="#FFFFFF" height="56" rx="9" stroke="#D9E5F8" width="59" />
          <rect fill="#BEEAD9" height="7" rx="3.5" width="24" x="10" y="12" />
          <rect fill="#E8EEF7" height="4" rx="2" width="38" x="10" y="27" />
          <rect fill="#E8EEF7" height="4" rx="2" width="31" x="10" y="37" />
        </g>
        <circle cx="92" cy="22" fill="#FFD66B" r="5" />
        <circle cx="207" cy="63" fill="#7ED7B3" r="6" />
      </svg>
    );
  }

  if (kind === "rubric") {
    return (
      <svg aria-hidden="true" className="assignment-intelligence__visual" focusable="false" viewBox="0 0 300 92">
        <defs>
          <linearGradient id="rubric-blue" x1="0" x2="1">
            <stop stopColor="#0015D6" />
            <stop offset="1" stopColor="#0989FB" />
          </linearGradient>
        </defs>
        <path d="M35 64h230" stroke="#D8E1EF" strokeLinecap="round" strokeWidth="12" />
        <path d="M35 64h64" stroke="#EF6B72" strokeLinecap="round" strokeWidth="12" />
        <path d="M105 64h55" stroke="#FFD66B" strokeLinecap="round" strokeWidth="12" />
        <path d="M166 64h50" stroke="#81D9AE" strokeLinecap="round" strokeWidth="12" />
        <path d="M222 64h43" stroke="#4DC85B" strokeLinecap="round" strokeWidth="12" />
        <g transform="translate(55 18)">
          <path d="M0 17V6a6 6 0 0 1 6-6h35a6 6 0 0 1 6 6v11" fill="#FFF" stroke="#F3B6BA" strokeWidth="2" />
          <path d="m17 10 6 6 8-11" fill="none" stroke="#E75660" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          <path d="m23 30-7-9h14Z" fill="#E75660" />
        </g>
        <g transform="translate(128 18)">
          <rect fill="#FFF" height="27" rx="7" stroke="#D5DFF0" strokeWidth="2" width="49" />
          <path d="M12 9h25M12 16h17" stroke="#8C9BB1" strokeLinecap="round" strokeWidth="3" />
          <path d="m24 30-7-9h14Z" fill="#F0B83E" />
        </g>
        <g transform="translate(205 18)">
          <circle cx="24" cy="13" fill="#EAF4FF" r="13" />
          <path d="M17 13h14M24 6v14" stroke="url(#rubric-blue)" strokeLinecap="round" strokeWidth="3" />
          <path d="m24 30-7-9h14Z" fill="#38B96A" />
        </g>
      </svg>
    );
  }

  if (kind === "evidence") {
    return (
      <svg aria-hidden="true" className="assignment-intelligence__visual" focusable="false" viewBox="0 0 300 92">
        <defs>
          <linearGradient id="evidence-node" x1="0" x2="1">
            <stop stopColor="#0015D6" />
            <stop offset="1" stopColor="#0989FB" />
          </linearGradient>
        </defs>
        <path d="M72 26c28 0 32 20 52 20M228 25c-27 0-32 21-52 21M72 66c27 0 32-18 52-18M228 66c-27 0-32-18-52-18" fill="none" stroke="#C9D8EF" strokeDasharray="4 5" strokeLinecap="round" strokeWidth="2" />
        <rect fill="#FFFFFF" height="38" rx="11" stroke="#BFD4F4" width="70" x="115" y="27" />
        <path d="M134 43c0-5 3-8 8-8v6c-2 0-3 1-3 3h4v8h-9Zm14 0c0-5 3-8 8-8v6c-2 0-3 1-3 3h4v8h-9Z" fill="url(#evidence-node)" />
        <g transform="translate(28 13)">
          <rect fill="#FFFFFF" height="26" rx="8" stroke="#D7E2F1" width="54" />
          <circle cx="13" cy="13" fill="#6CA8FF" r="5" />
          <path d="M24 10h20M24 16h14" stroke="#9AA8BB" strokeLinecap="round" strokeWidth="3" />
        </g>
        <g transform="translate(218 12)">
          <rect fill="#FFFFFF" height="27" rx="8" stroke="#D7E2F1" width="55" />
          <path d="m12 14 4 4 8-10" fill="none" stroke="#35B876" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          <path d="M31 10h14M31 17h10" stroke="#9AA8BB" strokeLinecap="round" strokeWidth="3" />
        </g>
        <g transform="translate(30 54)">
          <rect fill="#FFF9E9" height="25" rx="8" stroke="#F4D98B" width="52" />
          <circle cx="13" cy="12.5" fill="#F1B83D" r="4" />
          <path d="M23 10h19M23 16h13" stroke="#B49550" strokeLinecap="round" strokeWidth="3" />
        </g>
        <g transform="translate(218 54)">
          <rect fill="#F0FBF6" height="25" rx="8" stroke="#BDE8D2" width="54" />
          <path d="M11 8h12v10H11z" fill="#63CCA0" rx="2" />
          <path d="M31 10h13M31 16h9" stroke="#6C9B85" strokeLinecap="round" strokeWidth="3" />
        </g>
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="assignment-intelligence__visual" focusable="false" viewBox="0 0 300 92">
      <defs>
        <linearGradient id="authorship-shield" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#0015D6" />
          <stop offset="1" stopColor="#0989FB" />
        </linearGradient>
      </defs>
      <path d="M150 13c15 10 30 11 39 12v21c0 19-14 31-39 38-25-7-39-19-39-38V25c9-1 24-2 39-12Z" fill="url(#authorship-shield)" />
      <circle cx="150" cy="38" fill="#FFFFFF" r="9" />
      <path d="M133 62c2-11 8-16 17-16s15 5 17 16" fill="#FFFFFF" />
      <g transform="translate(28 25)">
        <rect fill="#FFFFFF" height="39" rx="11" stroke="#D5E1F1" width="66" />
        <circle cx="17" cy="19" fill="#7ED7B3" r="8" />
        <path d="m13 19 3 3 6-7" fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
        <path d="M33 14h22M33 22h15" stroke="#8D9BAE" strokeLinecap="round" strokeWidth="3" />
      </g>
      <g transform="translate(206 24)">
        <rect fill="#FFFFFF" height="41" rx="11" stroke="#D5E1F1" width="66" />
        <path d="m17 28 5-17 6 12Z" fill="#FFD66B" stroke="#D7A62E" strokeLinejoin="round" strokeWidth="2" />
        <path d="M36 14h19M36 22h14M36 30h20" stroke="#8D9BAE" strokeLinecap="round" strokeWidth="3" />
      </g>
      <circle cx="101" cy="18" fill="#F19BA0" r="5" />
      <circle cx="199" cy="71" fill="#73C9FF" r="6" />
    </svg>
  );
}
