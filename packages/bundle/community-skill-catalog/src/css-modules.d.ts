declare module '*.module.css' {
  const classes: Readonly<Record<string, string | undefined>>
  export default classes
}
