import { useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'

const PAGE_SIZES = [10, 25, 50, 100]

function isNumericColumn(rows, column) {
  let seen = 0
  for (const row of rows) {
    const value = row[column]
    if (value === '' || value == null) continue
    if (Number.isNaN(Number(value))) return false
    seen++
  }
  return seen > 0
}

function emptyFilter(type) {
  return type === 'number' ? { min: '', max: '' } : { text: '', exact: '' }
}

export default function CsvViewer() {
  const [fileName, setFileName] = useState('')
  const [columns, setColumns] = useState([])
  const [columnTypes, setColumnTypes] = useState({})
  const [rows, setRows] = useState([])
  const [filters, setFilters] = useState({})
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ column: null, direction: 'asc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleFile = (file) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a .csv file.')
      return
    }
    setError('')
    setLoading(true)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h, i) => h.trim() || `Column ${i + 1}`,
      complete: (result) => {
        const fields = result.meta.fields || []
        const data = result.data
        if (!fields.length || !data.length) {
          setError('The file has no data rows.')
          setLoading(false)
          return
        }
        const types = {}
        const initialFilters = {}
        fields.forEach((f) => {
          types[f] = isNumericColumn(data, f) ? 'number' : 'text'
          initialFilters[f] = emptyFilter(types[f])
        })
        setFileName(file.name)
        setColumns(fields)
        setColumnTypes(types)
        setRows(data)
        setFilters(initialFilters)
        setSearch('')
        setSort({ column: null, direction: 'asc' })
        setPage(1)
        if (result.errors.length) {
          setError(`Parsed with ${result.errors.length} warning(s). First: row ${result.errors[0].row + 1}: ${result.errors[0].message}`)
        }
        setLoading(false)
      },
      error: (err) => {
        setError(`Failed to read file: ${err.message}`)
        setLoading(false)
      },
    })
  }

  const uniqueValues = useMemo(() => {
    const map = {}
    columns.forEach((c) => {
      if (columnTypes[c] !== 'text') return
      const set = new Set(rows.map((r) => r[c] ?? ''))
      map[c] = set.size <= 30 ? [...set].sort((a, b) => String(a).localeCompare(String(b))) : null
    })
    return map
  }, [columns, columnTypes, rows])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (term && !columns.some((c) => String(row[c] ?? '').toLowerCase().includes(term))) return false
      return columns.every((c) => {
        const f = filters[c]
        if (!f) return true
        const value = row[c] ?? ''
        if (columnTypes[c] === 'number') {
          if (f.min === '' && f.max === '') return true
          if (value === '') return false
          const n = Number(value)
          if (f.min !== '' && n < Number(f.min)) return false
          if (f.max !== '' && n > Number(f.max)) return false
          return true
        }
        if (f.exact !== '' && String(value) !== f.exact) return false
        if (f.text && !String(value).toLowerCase().includes(f.text.toLowerCase())) return false
        return true
      })
    })
  }, [rows, columns, columnTypes, filters, search])

  const sortedRows = useMemo(() => {
    if (!sort.column) return filteredRows
    const { column, direction } = sort
    const factor = direction === 'asc' ? 1 : -1
    const numeric = columnTypes[column] === 'number'
    return [...filteredRows].sort((a, b) => {
      const av = a[column] ?? ''
      const bv = b[column] ?? ''
      if (av === '' && bv !== '') return 1
      if (bv === '' && av !== '') return -1
      if (numeric) return (Number(av) - Number(bv)) * factor
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * factor
    })
  }, [filteredRows, sort, columnTypes])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const updateFilter = (column, key, value) => {
    setFilters((prev) => ({ ...prev, [column]: { ...prev[column], [key]: value } }))
    setPage(1)
  }

  const clearFilters = () => {
    const reset = {}
    columns.forEach((c) => {
      reset[c] = emptyFilter(columnTypes[c])
    })
    setFilters(reset)
    setSearch('')
    setPage(1)
  }

  const toggleSort = (column) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: 'asc' }
      if (prev.direction === 'asc') return { column, direction: 'desc' }
      return { column: null, direction: 'asc' }
    })
  }

  const resetAll = () => {
    setFileName('')
    setColumns([])
    setColumnTypes({})
    setRows([])
    setFilters({})
    setSearch('')
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const activeFilterCount =
    columns.filter((c) => {
      const f = filters[c]
      if (!f) return false
      return columnTypes[c] === 'number' ? f.min !== '' || f.max !== '' : f.text !== '' || f.exact !== ''
    }).length + (search.trim() ? 1 : 0)

  const exportFiltered = () => {
    const csv = Papa.unparse({ fields: columns, data: sortedRows.map((r) => columns.map((c) => r[c] ?? '')) })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName.replace(/\.csv$/i, '') + '-filtered.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="container">
      <header className="header">
        <h1>CSV Viewer</h1>
        <p className="subtitle">Upload a CSV file to view, sort, and filter its data.</p>
      </header>

      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFile(e.dataTransfer.files[0])
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {loading ? (
          <span>Parsing…</span>
        ) : fileName ? (
          <span>
            <strong>{fileName}</strong> — {rows.length.toLocaleString()} rows, {columns.length} columns. Click or drop to replace.
          </span>
        ) : (
          <span>
            <strong>Click to choose</strong> or drag and drop a CSV file here
          </span>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {columns.length > 0 && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Filters {activeFilterCount > 0 && <span className="badge">{activeFilterCount} active</span>}</h2>
              <div className="actions">
                <button onClick={clearFilters} disabled={activeFilterCount === 0}>
                  Clear filters
                </button>
                <button onClick={exportFiltered} disabled={sortedRows.length === 0}>
                  Export filtered
                </button>
                <button className="danger" onClick={resetAll}>
                  Remove file
                </button>
              </div>
            </div>

            <input
              className="search"
              type="search"
              placeholder="Search all columns…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />

            <div className="filter-grid">
              {columns.map((c) => (
                <div key={c} className="filter">
                  <label title={c}>
                    {c} <span className="type">{columnTypes[c]}</span>
                  </label>
                  {columnTypes[c] === 'number' ? (
                    <div className="range">
                      <input
                        type="number"
                        placeholder="Min"
                        value={filters[c]?.min ?? ''}
                        onChange={(e) => updateFilter(c, 'min', e.target.value)}
                      />
                      <input
                        type="number"
                        placeholder="Max"
                        value={filters[c]?.max ?? ''}
                        onChange={(e) => updateFilter(c, 'max', e.target.value)}
                      />
                    </div>
                  ) : uniqueValues[c] ? (
                    <select value={filters[c]?.exact ?? ''} onChange={(e) => updateFilter(c, 'exact', e.target.value)}>
                      <option value="">All</option>
                      {uniqueValues[c].map((v) => (
                        <option key={v} value={v}>
                          {v === '' ? '(empty)' : v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="Contains…"
                      value={filters[c]?.text ?? ''}
                      onChange={(e) => updateFilter(c, 'text', e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>
                Showing {sortedRows.length.toLocaleString()} of {rows.length.toLocaleString()} rows
              </h2>
              <label className="page-size">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(1)
                  }}
                >
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="index">#</th>
                    {columns.map((c) => (
                      <th
                        key={c}
                        onClick={() => toggleSort(c)}
                        className={columnTypes[c] === 'number' ? 'num' : ''}
                        aria-sort={sort.column === c ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        {c}
                        <span className="sort">{sort.column === c ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="empty">
                        No rows match the current filters.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row, i) => (
                      <tr key={(currentPage - 1) * pageSize + i}>
                        <td className="index">{(currentPage - 1) * pageSize + i + 1}</td>
                        {columns.map((c) => (
                          <td key={c} className={columnTypes[c] === 'number' ? 'num' : ''}>
                            {row[c]}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button onClick={() => setPage(1)} disabled={currentPage === 1}>
                «
              </button>
              <button onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>
                ‹ Prev
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}>
                Next ›
              </button>
              <button onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
                »
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
