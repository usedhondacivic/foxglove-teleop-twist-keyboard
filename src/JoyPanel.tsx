import {
  Topic,
  PanelExtensionContext,
  SettingsTreeAction,
  SettingsTreeNode,
  SettingsTreeNodes,
} from "@foxglove/extension";
import { set } from "lodash";
import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import ReactDOM from "react-dom";

const keyOrder = ["u", "i", "o", "j", "k", "l", "m", ",", "."];

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
function JoyPanel({ context }: { context: PanelExtensionContext }): JSX.Element {
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

  // const nextCmdPt = React.useRef<[number, number] | null>(null);
  // const nextCmdIntervalId = React.useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Clean up
    return () => {
      // if (nextCmdIntervalId.current) {
      //   clearInterval(nextCmdIntervalId.current);
      // }
    };
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
    renderDone?.();
  }, [renderDone]);

  useEffect(() => {
    const tree = buildSettingsTree(config, topics);
    context.updatePanelSettingsEditor({
      actionHandler: settingsActionHandler,
      nodes: tree,
    });
    saveState(config);
  }, [config, context, saveState, settingsActionHandler, topics]);

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

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  });

  const keyElements = keys.map((pressed, i) => {
    return (
      <div
        key={keyOrder[i]}
        style={{ width: "50px", height: "50px", background: pressed ? "lightblue" : "none" }}
      >
        {keyOrder[i]}: {pressed ? "true" : "false"}
      </div>
    );
  });

  return (
    <div style={{ padding: "1rem", display: "grid", gridTemplateColumns: "50px 50px 50px" }}>
      {keyElements}
    </div>
  );
}

export function initJoyPanel(context: PanelExtensionContext): () => void {
  ReactDOM.render(<JoyPanel context={context} />, context.panelElement);

  // Return a function to run when the panel is removed
  return () => {
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}
