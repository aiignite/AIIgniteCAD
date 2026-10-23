/**
 * RemoteCursors.tsx — 其他协作者的光标
 *
 * 光标按世界坐标绘制在 SVG 内，随缩放一起变换；尺寸除以像素比例，
 * 保证不同缩放级别下屏幕大小一致。
 */

import React, { useSyncExternalStore } from "react";
import {
    getCollaborationSnapshot,
    subscribeCollaboration,
    type PeerCursor,
} from "../store/collaboration";

const PEER_COLORS = ["#f97316", "#a855f7", "#06b6d4", "#ef4444", "#84cc16", "#eab308"];

function colorFor(socketId: string): string {
    let hash = 0;
    for (let i = 0; i < socketId.length; i++) {
        hash = (hash * 31 + socketId.charCodeAt(i)) >>> 0;
    }
    return PEER_COLORS[hash % PEER_COLORS.length];
}

interface RemoteCursorsProps {
    pixelsPerUnit: number;
}

export const RemoteCursors: React.FC<RemoteCursorsProps> = ({ pixelsPerUnit }) => {
    const snapshot = useSyncExternalStore(
        subscribeCollaboration,
        getCollaborationSnapshot,
        getCollaborationSnapshot,
    );

    if (!snapshot.enabled || snapshot.status !== "connected") return null;

    const scale = pixelsPerUnit > 0 ? 1 / pixelsPerUnit : 1;
    const cursors = (Object.values(snapshot.cursors) as PeerCursor[]).filter(
        (cursor) => cursor.socketId !== snapshot.selfId,
    );

    return (
        <g pointerEvents="none">
            {cursors.map((cursor) => {
                const color = colorFor(cursor.socketId);
                return (
                    <g key={cursor.socketId} transform={`translate(${cursor.x} ${cursor.y})`}>
                        <circle
                            r={5 * scale}
                            fill={color}
                            stroke="#ffffff"
                            strokeWidth={1.5 * scale}
                            opacity={0.9}
                        />
                        <text
                            x={10 * scale}
                            y={-8 * scale}
                            fill={color}
                            fontSize={11 * scale}
                            fontFamily="monospace"
                            style={{ userSelect: "none" }}
                        >
                            {cursor.username}
                        </text>
                    </g>
                );
            })}
        </g>
    );
};
