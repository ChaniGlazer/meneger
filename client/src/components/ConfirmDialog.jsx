import Modal from "./Modal";

/**
 * Replaces window.confirm/window.alert, which are unstyled, block the main
 * thread, and bypass the app's Hebrew voice. `danger` swaps the confirm
 * button for the filled destructive style and names the consequence in
 * `message` rather than a generic "are you sure?".
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "אישור",
  cancelLabel = "ביטול",
  danger,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p style={{ margin: 0 }}>{message}</p>
      <div className="admin-modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
