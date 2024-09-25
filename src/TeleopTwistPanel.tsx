/*
 * Based on: https://github.com/yulong88888/foxglove-nipple/blob/main/src/VirtualJoystickPanel.tsx
 * */

import {
  Topic,
  PanelExtensionContext,
  SettingsTreeAction,
  SettingsTreeNode,
  SettingsTreeNodes,
} from "@foxglove/extension";
import { set } from "lodash";
import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { Vector3, geometry_msgs__Twist, geometry_msgs__TwistStamped } from "./types";
import ReactDOM from "react-dom";

const keyOrder = ["u", "i", "o", "j", "k", "l", "m", ",", "."];
const directionOrder = ["🢄", "🢁", "🢅", "🢀", "○", "🢂", "🢇", "🢃", "🢆"];
const linearWeights = [0.7, 1.0, 0.7, 0.0, 0.0, 0.0, -0.7, -1.0, -0.7];
const angularWeights = [0.7, 0.0, -0.7, 1.0, 0.0, -1.0, 0.7, 0.0, -0.7];

// ros1
const TWIST_SCHEMA_ROS_1 = "geometry_msgs/Twist";
const TWIST_SCHEMA_STAMPED_ROS_1 = "geometry_msgs/TwistStamped";

// ros2
const TWIST_SCHEMA_STAMPED_ROS_2 = "geometry_msgs/msg/TwistStamped";
const TWIST_SCHEMA_ROS_2 = "geometry_msgs/msg/Twist";

type Config = {
  topic: string;
  messageSchema: string | undefined;
  publishRate: number;
  maxLinearSpeed: number;
  maxAngularSpeed: number;
};

function buildSettingsTree(config: Config, topics: readonly Topic[]): SettingsTreeNodes {
  const general: SettingsTreeNode = {
    label: "General",
    fields: {
      topic: {
        label: "Topic",
        input: "autocomplete",
        value: config.topic,
        items: topics.map((t) => t.name),
        error: !topics.find(({ name }) => name === config.topic)
          ? "Topic does not exist"
          : undefined,
      },
      messageSchema: {
        input: "string",
        label: "Message Schema",
        value: config.messageSchema,
        error: !config.messageSchema ? "Message schema not found" : undefined,
        readonly: true,
      },
      publishRate: { label: "Publish rate", input: "number", value: config.publishRate },
      maxLinearSpeed: { label: "Max linear", input: "number", value: config.maxLinearSpeed },
      maxAngularSpeed: { label: "Max angular", input: "number", value: config.maxAngularSpeed },
    },
  };

  return { general };
}
function TeleopTwistPanel({ context }: { context: PanelExtensionContext }): JSX.Element {
  /* Store the current topic */
  const [topics, setTopics] = useState<ReadonlyArray<Topic>>([]);
  const [currentTopic, setCurrentTopic] = useState<Topic | void>(() => {
    const initialState = context.initialState as Config;
    return initialState.topic && initialState.messageSchema
      ? {
          name: initialState.topic,
          schemaName: initialState.messageSchema,
          datatype: initialState.messageSchema,
        }
      : undefined;
  });
  const currentTopicRef = useRef<Topic | void>();
  currentTopicRef.current = currentTopic;

  /* Render complete callback */
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  /* Keyboard input state */
  const [keys, setKeys] = useState([false, false, false, false, false, false, false, false, false]);
  const keysRef = useRef<boolean[] | void>();
  keysRef.current = keys;

  const nextCmdIntervalId = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Side panel settings configuration */
  const [config, setConfig] = useState<Config>(() => {
    const partialConfig = context.initialState as Config;
    const { publishRate = 5, maxLinearSpeed = 1, maxAngularSpeed = 1, ...rest } = partialConfig;

    return {
      ...rest,
      publishRate,
      maxLinearSpeed,
      maxAngularSpeed,
    };
  });

  const { saveState } = context;

  /* Advertise the selected topic, and change it when the sidebar is updated */
  const advertiseTopic = useCallback(
    (topic: Topic) => {
      if (currentTopicRef.current?.name) {
        context.unadvertise?.(currentTopicRef.current.name);
      }
      context.advertise?.(topic.name, topic.schemaName);
    },
    [context],
  );

  useEffect(() => {
    if (currentTopic) {
      advertiseTopic(currentTopic);
    }
  });

  /* Handle changes made in the sidebar*/
  const settingsActionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action !== "update") {
        return;
      }

      setConfig((previous) => {
        const newConfig = { ...previous };
        set(newConfig, action.payload.path.slice(1), action.payload.value);

        if (newConfig.publishRate < 1) {
          newConfig.publishRate = 1;
        }
        if (newConfig.maxLinearSpeed < 0) {
          newConfig.maxLinearSpeed = 0;
        }
        if (newConfig.maxAngularSpeed < 0) {
          newConfig.maxAngularSpeed = 0;
        }

        const newTopic = topics.find((topic) => topic.name === newConfig.topic);
        setCurrentTopic(newTopic);
        if (newTopic && newTopic.name !== currentTopicRef.current?.name) {
          newConfig.messageSchema = newTopic.schemaName;
          newConfig.messageSchema = newTopic.schemaName;
        }

        return newConfig;
      });
    },
    [topics],
  );

  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setTopics(
        renderState.topics?.filter(({ schemaName }) => {
          return [
            TWIST_SCHEMA_ROS_1,
            TWIST_SCHEMA_ROS_2,
            TWIST_SCHEMA_STAMPED_ROS_1,
            TWIST_SCHEMA_STAMPED_ROS_2,
          ].includes(schemaName);
        }) ?? [],
      );
    };

    context.watch("topics");
  }, [context]);

  useEffect(() => {
    const tree = buildSettingsTree(config, topics);
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: tree,
    });
    saveState(config);
  }, [config, context, saveState, settingsActionHandler, topics]);

  const cmdMove = useCallback(() => {
    let numKeysPressed = 1.0;
    if (keysRef && keysRef.current) {
      numKeysPressed = keysRef.current.filter(Boolean).length;
      if (numKeysPressed === 0) {
        numKeysPressed = 1;
      }
    }
    const lx =
      linearWeights
        .filter((_, i) => {
          if (keysRef && keysRef.current) {
            return keysRef.current[i];
          }
          return false;
        })
        .reduce((ps, a) => ps + a, 0) / numKeysPressed;
    const az =
      angularWeights
        .filter((_, i) => {
          if (keysRef && keysRef.current) {
            return keysRef.current[i];
          }
          return false;
        })
        .reduce((ps, a) => ps + a, 0) / numKeysPressed;

    const linearSpeed = lx * config.maxLinearSpeed;
    const angularSpeed = az * config.maxAngularSpeed;

    const linearVec: Vector3 = {
      x: linearSpeed,
      y: 0,
      z: 0,
    };

    const angularVec: Vector3 = {
      x: 0,
      y: 0,
      z: angularSpeed,
    };

    let message: geometry_msgs__Twist | geometry_msgs__TwistStamped;
    const schemaName = currentTopicRef.current?.schemaName ?? "";
    if ([TWIST_SCHEMA_STAMPED_ROS_1, TWIST_SCHEMA_STAMPED_ROS_2].includes(schemaName)) {
      message = {
        header: {
          stamp: { sec: 0, nsec: 0 },
          // eslint-disable-next-line no-warning-comments
          // TODO: Make frame_id configurable
          frame_id: "",
        },
        twist: {
          linear: linearVec,
          angular: angularVec,
        },
      };
    } else if ([TWIST_SCHEMA_ROS_1, TWIST_SCHEMA_ROS_2].includes(schemaName)) {
      message = {
        linear: linearVec,
        angular: angularVec,
      };
    } else {
      console.error("Unknown message schema");
      return;
    }
    if (currentTopicRef.current?.name) {
      context.publish?.(currentTopicRef.current.name, message);
    }
  }, [config, context]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const newKeys = keys.map((c, i) => {
        if (i === keyOrder.indexOf(e.key)) {
          return true;
        } else {
          return c;
        }
      });
      setKeys(newKeys);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const newKeys = keys.map((c, i) => {
        if (i === keyOrder.indexOf(e.key)) {
          return false;
        } else {
          return c;
        }
      });
      setKeys(newKeys);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    nextCmdIntervalId.current = setInterval(cmdMove, 1000 / config.publishRate);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      if (nextCmdIntervalId.current) {
        clearInterval(nextCmdIntervalId.current);
      }
    };
  });

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  /* Create elements to display the keys*/
  const keyElements = keys.map((pressed, i) => {
    return (
      <div
        key={keyOrder[i]}
        style={{
          width: "50px",
          height: "50px",
          textAlign: "center",
          background: pressed ? "rgba(111, 0, 255, .2)" : "none",
          border: "1px solid rgba(255,255,255,.5)",
          position: "relative",
        }}
      >
        <p
          style={{
            position: "absolute",
            top: "25%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <b>{directionOrder[i]}</b>
          <br />
          {keyOrder[i]}
        </p>
      </div>
    );
  });

  return (
    <div style={{ padding: "1rem", width: "100%", height: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "50px 50px 50px",
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        {keyElements}
      </div>
    </div>
  );
}

export function initTeleopTwistPanel(context: PanelExtensionContext): () => void {
  ReactDOM.render(<TeleopTwistPanel context={context} />, context.panelElement);

  // Return a function to run when the panel is removed
  return () => {
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}
