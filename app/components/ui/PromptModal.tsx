"use client";

import { useState, useRef, useCallback, MouseEvent, useEffect } from "react";
import { playClickSound, playDoubleClickSound } from "@/app/utils/sounds";

interface PromptModalProps {
  isVisible: boolean;
  title: string;
  message: string;
  defaultValue?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
  confirmText?: string;
  cancelText?: string;
}

export default function PromptModal({
  isVisible,
  title,
  message,
  defaultValue = "",
  onClose,
  onConfirm,
  confirmText = "OK",
  cancelText = "Cancel",
}: PromptModalProps) {
  const [position, setPosition] = useState({ 
    x: typeof window !== 'undefined' ? window.innerWidth / 2 - 200 : 100, 
    y: typeof window !== 'undefined' ? window.innerHeight / 2 - 100 : 100 
  });
  const [isDragging, setIsDragging] = useState(false);
  const [inputValue, setInputValue] = useState(defaultValue);
  const dragOffset = useRef({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset input when modal opens/closes
  useEffect(() => {
    if (isVisible) {
      setInputValue(defaultValue);
      // Focus input after a short delay
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isVisible, defaultValue]);

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
    if (inputValue.trim() !== '') {
      onConfirm(inputValue.trim());
      onClose();
      playDoubleClickSound();
    } else {
      playClickSound();
    }
  };

  const handleCancel = () => {
    onClose();
    playDoubleClickSound();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Stop propagation to prevent game controls from triggering
    e.stopPropagation();
    
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
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

        {/* Input field */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => e.stopPropagation()}
          onKeyPress={(e) => e.stopPropagation()}
          className="rct-inset"
          style={{
            padding: "6px 8px",
            fontSize: 14,
            fontFamily: "var(--font-jersey), Arial, sans-serif",
            color: "var(--rct-text-light)",
            background: "var(--rct-panel-dark)",
            border: "1px solid",
            borderColor: "var(--rct-panel-dark) var(--rct-panel-light) var(--rct-panel-light) var(--rct-panel-dark)",
            outline: "none",
          }}
          placeholder="Enter name..."
        />

        {/* Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
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

