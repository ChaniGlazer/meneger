const COMMON = {
  width: "1em",
  height: "1em",
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false",
};

export function SendIcon(props) {
  return (
    <svg {...COMMON} {...props}>
      <path d="M17.5 2.5 2.5 8.75l5.63 2.12L10.25 17.5 17.5 2.5Z" />
      <path d="M17.5 2.5 8.13 10.87" />
    </svg>
  );
}

export function AttachIcon(props) {
  return (
    <svg {...COMMON} {...props}>
      <path d="M13.5 6.5 7.4 12.6a2.5 2.5 0 0 0 3.54 3.54l6.1-6.1a4.5 4.5 0 1 0-6.36-6.37L4.6 9.75a6.5 6.5 0 1 0 9.19 9.19" />
    </svg>
  );
}

export function EditIcon(props) {
  return (
    <svg {...COMMON} {...props}>
      <path d="M13.4 3.6 16.4 6.6 6.6 16.4 3 17l.6-3.6 9.8-9.8Z" />
    </svg>
  );
}

export function TrashIcon(props) {
  return (
    <svg {...COMMON} {...props}>
      <path d="M3.5 5.5h13" />
      <path d="M8 5.5v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M5.5 5.5 6.2 16a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-10.5" />
    </svg>
  );
}

export function ReplyIcon(props) {
  return (
    <svg {...COMMON} {...props}>
      <path d="M12.5 6.5 7 11l5.5 4.5" />
      <path d="M7 11h6a4 4 0 0 1 4 4v1" />
    </svg>
  );
}

export function UsersIcon(props) {
  return (
    <svg {...COMMON} {...props}>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M2.5 16.5a5 5 0 0 1 10 0" />
      <path d="M12.8 4.8a2.5 2.5 0 0 1 0 4.9" />
      <path d="M14.5 12a5 5 0 0 1 3 4.5" />
    </svg>
  );
}
