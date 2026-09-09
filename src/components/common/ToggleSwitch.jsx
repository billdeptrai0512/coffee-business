export default function ToggleSwitch({ checked, onChange, disabled }) {
    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            disabled={disabled}
            role="switch"
            aria-checked={checked}
            className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-border'}`}
        >
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
        </button>
    )
}
