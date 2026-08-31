# CPU kiosk vision POC research

## Decision context

The kiosk POC needs one reliable, local trigger: at least one visitor looks at
the fixed kiosk display for a configured dwell time. It must run on CPU and be
suitable for commercial distribution.

## Findings

### MediaPipe Face Landmarker is sufficient for the first trigger

MediaPipe Face Landmarker supports video and live-stream running modes, face
presence and tracking confidence thresholds, face landmarks, optional face
blendshapes, and optional facial transformation matrices. Those outputs are
enough to derive face presence, approximate head direction toward the display,
and sustained attention without a VLM or general object detector.

Source: [MediaPipe FaceLandmarkerOptions](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/FaceLandmarkerOptions)

MediaPipe states that Tasks process image and video input on-device rather than
sending it to Google servers. The repository is licensed under Apache-2.0.

Sources: [MediaPipe repository](https://github.com/google-ai-edge/mediapipe), [MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)

### TensorFlow.js face-landmark detection is a viable web-runtime alternative

TensorFlow.js distributes a real-time face-landmark detection model, and its
WASM backend supports BlazeFace and face-landmark detection. This makes it a
reasonable alternative if AIRI needs an all-TensorFlow.js runtime, but it does
not add a required capability for the first POC beyond MediaPipe Face
Landmarker.

Sources: [TensorFlow.js models](https://github.com/tensorflow/tfjs-models), [TensorFlow.js WASM backend](https://github.com/tensorflow/tfjs/blob/master/tfjs-backend-wasm/README.md)

### YOLO26 should not be on the POC critical path

Ultralytics documents YOLO26 as supporting detection, tracking-compatible
workloads, and depth-related tasks. It may later help normalize person location
and relative depth for group association, but the POC trigger only needs a
face-oriented attention signal.

The Ultralytics YOLO26 source is distributed under AGPL-3.0, so a closed-source
commercial deployment needs a separate license/compliance decision before it
is adopted.

Sources: [YOLO26 tasks](https://github.com/ultralytics/ultralytics/blob/main/docs/en/tasks/index.md), [YOLO26 configuration and license header](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/cfg/models/26/yolo26.yaml)

## Candidate choices

| Choice | CPU POC fit | Recommendation |
| --- | --- | --- |
| MediaPipe Face Landmarker | Directly supports local face presence, landmarks, tracking, live processing, and optional blendshapes under Apache-2.0. | Recommended baseline. |
| TensorFlow.js Face Landmarks + WASM | Viable local web option, but overlaps with the MediaPipe capability required by the POC. | Keep as an alternative, not a second runtime. |
| YOLO26 | Useful later for person-level location/depth; introduces licensing and extra runtime scope. | Defer until group-distance evidence is needed. |

## Proposed POC model boundary

**Selected baseline:** MediaPipe Face Landmarker.

Use MediaPipe Face Landmarker locally to emit anonymous signals:

- face present in the configured interaction area;
- approximate attention toward the kiosk;
- attention dwell duration;
- short-lived track identifier.

The Proactive Interaction module consumes those signals once per interaction
window and emits one neutral greeting. It should not require age, gender,
emotion, group association, a VLM, or a remote provider in the POC.
