"use client";

import { useState, useRef, useCallback, MouseEvent } from "react";
import { playClickSound, playDoubleClickSound } from "@/app/utils/sounds";

interface ModalProps {
  isVisible: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
}

export default function Modal({
  isVisible,
  title,
  message,
  onClose,
  onConfirm,
  confirmText = "OK",
  cancelText = "Cancel",
  showCancel = false,
}: ModalProps) {
  const [position, setPosition] = useState({ x: typeof window !== 'undefined' ? window.innerWidth / 2 - 200 : 100, y: typeof window !== 'undefined' ? window.innerHeight / 2 - 100 : 100 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    },
    [position]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      }
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    onClose();
    playDoubleClickSound();
  };

  const handleCancel = () => {
    onClose();
    playDoubleClickSound();
  };

  if (!isVisible) return null;

  return (
    <div
      className="rct-frame"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: 400,
        display: "flex",
        flexDirection: "column",
        zIndex: 3000,
        userSelect: "none",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Title bar */}
      <div className="rct-titlebar" onMouseDown={handleMouseDown}>
        <span>{title}</span>
        <button
          className="rct-close"
          onClick={handleCancel}
        >
          ×
        </button>
      </div>

      {/* Content panel */}
      <div
        className="rct-panel"
        style={{
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            color: "var(--rct-text-light)",
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
          }}
        >
          {message}
        </div>

        {/* Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
          {showCancel && (
            <button
              className="rct-button"
              onClick={handleCancel}
              style={{
                padding: "6px 16px",
                fontSize: 14,
              }}
            >
              {cancelText}
            </button>
          )}
          <button
            className="rct-button"
            onClick={handleConfirm}
            style={{
              padding: "6px 16px",
              fontSize: 14,
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

