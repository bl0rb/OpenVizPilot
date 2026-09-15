/**
 * Fixed, reviewed Metadata API documents. Values are always supplied through
 * GraphQL variables; callers must not interpolate user input into these strings.
 */
export const METADATA_SEARCH_QUERY = `query TableauMetadataSearch($filter: Field_Filter, $first: Int!, $after: String) {
  fieldsConnection(filter: $filter, first: $first, after: $after, permissionMode: FILTER_RESULTS) {
    nodes {
      __typename
      id
      name
      description
      datasource { id name }
      ... on DataField { dataType }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const METADATA_FIELD_QUERY = `query TableauMetadataField($filter: Field_Filter, $first: Int!) {
  fieldsConnection(filter: $filter, first: $first, permissionMode: FILTER_RESULTS) {
    nodes {
      __typename
      id
      name
      description
      datasource { id name }
      ... on DataField { dataType }
      ... on CalculatedField { formula }
      upstreamFieldsConnection(first: 10, filter: {}, permissionMode: FILTER_RESULTS) {
        nodes {
          __typename
          id
          name
          ... on DataField { dataType }
        }
        pageInfo { hasNextPage endCursor }
      }
      upstreamColumnsConnection(first: 10, filter: {}, permissionMode: FILTER_RESULTS) {
        nodes {
          id
          name
          table { id name }
        }
        pageInfo { hasNextPage endCursor }
      }
      downstreamSheetsConnection(first: 20, filter: {}, permissionMode: FILTER_RESULTS) {
        nodes {
          id
          name
          workbook { id name }
        }
        pageInfo { hasNextPage endCursor }
      }
      downstreamWorkbooksConnection(first: 20, filter: {}, permissionMode: FILTER_RESULTS) {
        nodes {
          __typename
          id
          name
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
