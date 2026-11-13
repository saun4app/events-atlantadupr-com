export function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;

  const finishField = () => {
    record.push(field);
    field = "";
    quoteClosed = false;
  };

  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (quoteClosed) {
      if (char === ",") {
        finishField();
      } else if (char === "\r" || char === "\n") {
        finishRecord();
        if (char === "\r" && input[i + 1] === "\n") i++;
      } else {
        throw new Error(`Unexpected character after closing quote at character ${i + 1}`);
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) {
        throw new Error(`Unexpected quote in unquoted field at character ${i + 1}`);
      }
      inQuotes = true;
    } else if (char === ",") {
      finishField();
    } else if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && input[i + 1] === "\n") i++;
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field");
  }

  if (record.length > 0 || field.length > 0 || quoteClosed) {
    finishField();
    records.push(record);
  }

  return records;
}