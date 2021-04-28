/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import {Button, notification, Typography} from 'antd';
import React, {createRef, useCallback} from 'react';
import {PluginClient} from '../plugin/Plugin';
import {usePlugin} from '../plugin/PluginContext';
import {createState, useValue} from '../state/atom';
import {createDataSource, DataSource} from '../state/DataSource';
import {DataInspector} from '../ui/data-inspector/DataInspector';
import {DataTable, DataTableColumn} from '../ui/data-table/DataTable';
import {DataTableManager} from '../ui/data-table/DataTableManager';
import {DetailSidebar} from '../ui/DetailSidebar';
import {Layout} from '../ui/Layout';
import {Panel} from '../ui/Panel';

function defaultRenderSidebar<T>(record: T) {
  return (
    <Panel title="Payload" collapsible={false} pad>
      <DataInspector data={record} expandRoot />
    </Panel>
  );
}

type PluginResult<Raw, Row> = {
  plugin(
    client: PluginClient<Record<string, Raw | {}>>,
  ): {
    rows: DataSource<Row>;
  };
  Component(): React.ReactElement;
};

/**
 * createTablePlugin creates a Plugin class which handles fetching data from the client and
 * displaying in in a table. The table handles selection of items and rendering a sidebar where
 * more detailed information can be presented about the selected row.
 *
 * The plugin expects the be able to subscribe to the `method` argument and recieve either an array
 * of data objects or a single data object. Each data object represents a row in the table which is
 * build by calling the `buildRow` function argument.
 *
 * An optional resetMethod argument can be provided which will replace the current rows with the
 * data provided. This is useful when connecting to Flipper for this first time, or reconnecting to
 * the client in an unknown state.
 */
export function createTablePlugin<Row extends object>(props: {
  method: string;
  resetMethod?: string;
  columns: DataTableColumn<Row>[];
  renderSidebar?: (record: Row) => any;
  key?: keyof Row;
}): PluginResult<Row, Row>;
export function createTablePlugin<
  Raw extends object,
  Row extends object = Raw
>(props: {
  buildRow: (record: Raw) => Row;
  method: string;
  resetMethod?: string;
  columns: DataTableColumn<Row>[];
  renderSidebar?: (record: Row) => any;
  key?: keyof Raw;
}): PluginResult<Raw, Row>;
export function createTablePlugin<
  Raw extends object,
  Method extends string,
  ResetMethod extends string,
  Row extends object = Raw
>(props: {
  method: Method;
  resetMethod?: ResetMethod;
  columns: DataTableColumn<Row>[];
  renderSidebar?: (record: Row) => any;
  buildRow?: (record: Raw) => Row;
  key?: keyof Raw;
}) {
  function plugin(
    client: PluginClient<Record<Method, Raw> & Record<ResetMethod, {}>, {}>,
  ) {
    const rows = createDataSource<Row>([], {
      persist: 'rows',
      key: props.key,
    });
    const selection = createState<undefined | Row>(undefined);
    const isPaused = createState(false);
    const tableManagerRef = createRef<undefined | DataTableManager<Row>>();

    client.onMessage(props.method, (event) => {
      if (isPaused.get()) {
        return;
      }
      const record = props.buildRow
        ? props.buildRow(event)
        : ((event as any) as Row);
      if (props.key) {
        rows.upsert(record);
      } else {
        rows.append(record);
      }
    });

    if (props.resetMethod) {
      client.onMessage(props.resetMethod, () => {
        clear();
      });
    }

    // help plugin authors with finding out what the events and data shape is from the plugin
    const unhandledMessagesSeen = new Set<string>();
    client.onUnhandledMessage((message, params) => {
      if (unhandledMessagesSeen.has(message)) {
        return;
      }
      unhandledMessagesSeen.add(message);
      notification.warn({
        message: 'Unhandled message: ' + message,
        description: (
          <Typography.Paragraph>
            <pre>{JSON.stringify(params, null, 2)}</pre>
          </Typography.Paragraph>
        ),
      });
    });

    client.addMenuEntry(
      {
        action: 'clear',
        handler: clear,
      },
      {
        action: 'createPaste',
        handler: createPaste,
      },
      {
        action: 'goToBottom',
        handler: goToBottom,
      },
    );

    function clear() {
      rows.clear();
      tableManagerRef.current?.clearSelection();
    }

    function createPaste() {
      let selection = tableManagerRef.current?.getSelectedItems();
      if (!selection?.length) {
        selection = rows.view.output(0, rows.view.size);
      }
      if (selection?.length) {
        client.createPaste(JSON.stringify(selection, null, 2));
      }
    }

    function goToBottom() {
      tableManagerRef?.current?.selectItem(rows.view.size - 1);
    }

    return {
      selection,
      rows,
      clear,
      tableManagerRef,
      connected: client.connected,
      isPaused,
      resumePause() {
        isPaused.update((v) => !v);
      },
    };
  }

  function Component() {
    const instance = usePlugin(plugin);
    const paused = useValue(instance.isPaused);
    const selection = useValue(instance.selection);
    const connected = useValue(instance.connected);

    const handleSelect = useCallback((v) => instance.selection.set(v), [
      instance,
    ]);

    return (
      <Layout.Container grow>
        <DataTable<Row>
          columns={props.columns}
          dataSource={instance.rows}
          tableManagerRef={instance.tableManagerRef}
          autoScroll
          onSelect={handleSelect}
          extraActions={
            connected ? (
              <>
                <Button
                  title={`Click to ${paused ? 'resume' : 'pause'} the stream`}
                  danger={paused}
                  onClick={instance.resumePause}>
                  {paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                </Button>
                <Button title="Clear records" onClick={instance.clear}>
                  <DeleteOutlined />
                </Button>
              </>
            ) : undefined
          }
        />
        <DetailSidebar>
          {selection
            ? props.renderSidebar?.(selection) ??
              defaultRenderSidebar(selection)
            : null}
        </DetailSidebar>
      </Layout.Container>
    );
  }

  return {plugin, Component};
}
